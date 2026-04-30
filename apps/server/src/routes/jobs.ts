import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { jobQueue } from '../queue/JobQueue.js';
import type { TrainJob, TrainJobInput, PreprocessOptions, TrainParams } from '../types/job.js';
import { ADVANCED_SETTINGS_PROFILES } from '../types/job.js';
import { dbGetLogs, dbListProfiles } from '../db/client.js';

const MANAGED_PROMPT_EXTENSION = '.prompt.txt';
const TRAINING_PROMPT_EXTENSION = '.train.txt';
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.avif'] as const;
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

interface PromptSubsetRef {
  workKey: string;
  label: string;
  imageDir: string;
}

interface PromptFileEntry {
  id: string;
  relativePath: string;
  imageRelativePath?: string;
  baseName: string;
  updatedAt: string;
  size: number;
}

interface PromptSubsetEntry {
  workKey: string;
  label: string;
  imageDir: string;
  effectiveDir: string;
  available: boolean;
  items: PromptFileEntry[];
}

interface PromptListResponse {
  promptExtension: string;
  trainingExtension: string;
  subsets: PromptSubsetEntry[];
}

function subsetWorkKey(index: number, imageDir: string): string {
  const baseName = path.basename(imageDir) || `subset_${index + 1}`;
  const safeName = Array.from(baseName)
    .map(char => (/^[a-z0-9]$/i.test(char) ? char : '_'))
    .join('')
    .replace(/^_+|_+$/g, '') || `subset_${index + 1}`;
  return `${String(index + 1).padStart(2, '0')}_${safeName}`;
}

function resolvePromptSubsets(input: TrainJobInput): PromptSubsetRef[] {
  const subsets = (input.datasetSubsets ?? [])
    .map((subset, index) => {
      const imageDir = String(subset.imageDir ?? '').trim();
      if (!imageDir) return null;
      return {
        workKey: subsetWorkKey(index, imageDir),
        label: `${index + 1}:${path.basename(imageDir) || `subset_${index + 1}`}`,
        imageDir,
      } satisfies PromptSubsetRef;
    })
    .filter((subset): subset is PromptSubsetRef => Boolean(subset));

  if (subsets.length > 0) return subsets;

  const datasetDir = String(input.datasetDir ?? '').trim();
  if (!datasetDir) return [];
  return [{
    workKey: subsetWorkKey(0, datasetDir),
    label: `1:${path.basename(datasetDir) || 'subset_1'}`,
    imageDir: datasetDir,
  }];
}

function resolveEffectiveSubsetDir(job: TrainJob, subset: PromptSubsetRef): string {
  const rootDir = job.preprocessOptions.runResize && !job.preprocessOptions.skipPreprocessing
    ? 'resized'
    : job.preprocessOptions.normalizeImages && !job.preprocessOptions.skipPreprocessing
      ? 'normalized'
    : 'prepared';
  return path.join(job.workDir, rootDir, subset.workKey);
}

function isWithinDir(rootDir: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootDir, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function listPromptFiles(rootDir: string): Promise<PromptFileEntry[]> {
  const items: PromptFileEntry[] = [];

  async function findImageRelativePath(promptRelativePath: string): Promise<string | undefined> {
    const stem = promptRelativePath.slice(0, -MANAGED_PROMPT_EXTENSION.length);
    for (const extension of IMAGE_EXTENSIONS) {
      const candidateRelativePath = `${stem}${extension}`;
      const candidatePath = path.resolve(rootDir, candidateRelativePath);
      if (!isWithinDir(rootDir, candidatePath)) continue;
      const stats = await fs.stat(candidatePath).catch(() => null);
      if (stats?.isFile()) return candidateRelativePath.replaceAll('\\', '/');
    }
    return undefined;
  }

  async function walk(dirPath: string): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(MANAGED_PROMPT_EXTENSION)) continue;

      const stats = await fs.stat(fullPath);
      const relativePath = path.relative(rootDir, fullPath).replaceAll('\\', '/');
      items.push({
        id: relativePath,
        relativePath,
        imageRelativePath: await findImageRelativePath(relativePath),
        baseName: path.basename(relativePath, MANAGED_PROMPT_EXTENSION),
        updatedAt: stats.mtime.toISOString(),
        size: stats.size,
      });
    }
  }

  await walk(rootDir);
  return items.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function getPromptSubset(job: TrainJob, workKey: string): PromptSubsetRef {
  const subset = resolvePromptSubsets(job.input).find(entry => entry.workKey === workKey);
  if (!subset) throw new Error(`Unknown dataset subset: ${workKey}`);
  return subset;
}

function resolveManagedPromptPath(job: TrainJob, subset: PromptSubsetRef, relativePath: string): string {
  const effectiveDir = resolveEffectiveSubsetDir(job, subset);
  const normalizedRelativePath = path.normalize(relativePath).replace(/^([./\\])+/, '');
  const promptPath = path.resolve(effectiveDir, normalizedRelativePath);
  if (!promptPath.endsWith(MANAGED_PROMPT_EXTENSION)) {
    throw new Error('Only managed prompt files can be edited');
  }
  if (!isWithinDir(effectiveDir, promptPath)) {
    throw new Error('Prompt path is outside of the managed dataset directory');
  }
  return promptPath;
}

function resolveManagedImagePath(job: TrainJob, subset: PromptSubsetRef, relativePath: string): string {
  const effectiveDir = resolveEffectiveSubsetDir(job, subset);
  const normalizedRelativePath = path.normalize(relativePath).replace(/^([./\\])+/, '');
  const imagePath = path.resolve(effectiveDir, normalizedRelativePath);
  const extension = path.extname(imagePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(extension as (typeof IMAGE_EXTENSIONS)[number])) {
    throw new Error('Only managed dataset images can be previewed');
  }
  if (!isWithinDir(effectiveDir, imagePath)) {
    throw new Error('Image path is outside of the managed dataset directory');
  }
  return imagePath;
}

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  // List all jobs
  app.get('/api/jobs', async () => jobQueue.list());

  // Get single job
  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const job = jobQueue.get(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    return job;
  });

  // Create job
  app.post<{ Body: { input: TrainJobInput; preprocessOptions?: Partial<PreprocessOptions> } }>(
    '/api/jobs',
    async (req, reply) => {
      try {
        const job = jobQueue.createJob(req.body.input, req.body.preprocessOptions);
        reply.status(201).send(job);
      } catch (err) {
        reply.status(400).send({ error: String(err) });
      }
    },
  );

  // Start job
  app.post<{ Params: { id: string } }>('/api/jobs/:id/start', async (req, reply) => {
    try {
      await jobQueue.startJob(req.params.id);
      return { ok: true };
    } catch (err) {
      reply.status(400).send({ error: String(err) });
    }
  });

  // Stop job
  app.post<{ Params: { id: string } }>('/api/jobs/:id/stop', async (req, reply) => {
    try {
      jobQueue.stopJob(req.params.id);
      return { ok: true };
    } catch (err) {
      reply.status(400).send({ error: String(err) });
    }
  });

  // Delete job history
  app.delete<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    try {
      jobQueue.deleteJob(req.params.id);
      return { ok: true };
    } catch (err) {
      reply.status(400).send({ error: String(err) });
    }
  });

  // Resume job (staged retry)
  app.post<{ Params: { id: string } }>('/api/jobs/:id/resume', async (req, reply) => {
    try {
      await jobQueue.resumeJob(req.params.id);
      return { ok: true };
    } catch (err) {
      reply.status(400).send({ error: String(err) });
    }
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/continue', async (req, reply) => {
    try {
      await jobQueue.continueJob(req.params.id);
      return { ok: true };
    } catch (err) {
      reply.status(400).send({ error: String(err) });
    }
  });

  app.patch<{
    Params: { id: string };
    Body: { params?: Record<string, unknown> };
  }>('/api/jobs/:id/params', async (req, reply) => {
    try {
      const job = jobQueue.updateParams(req.params.id, (req.body.params ?? {}) as Partial<TrainParams>);
      return job;
    } catch (err) {
      reply.status(400).send({ error: String(err) });
    }
  });

  // Update dataset for fine-tune loop
  app.patch<{
    Params: { id: string };
    Body: { addImages?: string[]; removeImages?: string[]; params?: Record<string, unknown> };
  }>('/api/jobs/:id/dataset', async (req, reply) => {
    try {
      const job = jobQueue.updateDatasetConfig(req.params.id, req.body as Parameters<typeof jobQueue.updateDatasetConfig>[1]);
      return job;
    } catch (err) {
      reply.status(400).send({ error: String(err) });
    }
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id/prompts', async (req, reply) => {
    const job = jobQueue.get(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });

    const subsets = await Promise.all(resolvePromptSubsets(job.input).map(async subset => {
      const effectiveDir = resolveEffectiveSubsetDir(job, subset);
      const available = await fs.stat(effectiveDir).then(() => true).catch(() => false);
      const items = available ? await listPromptFiles(effectiveDir) : [];
      return {
        ...subset,
        effectiveDir,
        available,
        items,
      } satisfies PromptSubsetEntry;
    }));

    const response: PromptListResponse = {
      promptExtension: MANAGED_PROMPT_EXTENSION,
      trainingExtension: TRAINING_PROMPT_EXTENSION,
      subsets,
    };
    return response;
  });

  app.get<{
    Params: { id: string };
    Querystring: { subset: string; path: string };
  }>('/api/jobs/:id/prompts/content', async (req, reply) => {
    const job = jobQueue.get(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });

    try {
      const subset = getPromptSubset(job, req.query.subset);
      const promptPath = resolveManagedPromptPath(job, subset, req.query.path);
      const stats = await fs.stat(promptPath);
      const content = await fs.readFile(promptPath, 'utf-8');
      return { content, updatedAt: stats.mtime.toISOString() };
    } catch (error) {
      return reply.status(400).send({ error: String(error) });
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { subset: string; path: string };
  }>('/api/jobs/:id/prompts/image', async (req, reply) => {
    const job = jobQueue.get(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });

    try {
      const subset = getPromptSubset(job, req.query.subset);
      const imagePath = resolveManagedImagePath(job, subset, req.query.path);
      const stats = await fs.stat(imagePath);
      if (!stats.isFile()) return reply.status(404).send({ error: 'Image not found' });
      const extension = path.extname(imagePath).toLowerCase();
      reply.header('Cache-Control', 'no-store');
      reply.type(IMAGE_MIME_TYPES[extension] ?? 'application/octet-stream');
      return reply.send(await fs.readFile(imagePath));
    } catch (error) {
      return reply.status(400).send({ error: String(error) });
    }
  });

  app.put<{
    Params: { id: string };
    Body: { subset: string; path: string; content: string };
  }>('/api/jobs/:id/prompts/content', async (req, reply) => {
    const job = jobQueue.get(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    if (job.status === 'running') {
      return reply.status(409).send({ error: 'Cannot edit prompts while the job is running' });
    }

    try {
      const subset = getPromptSubset(job, req.body.subset);
      const promptPath = resolveManagedPromptPath(job, subset, req.body.path);
      await fs.mkdir(path.dirname(promptPath), { recursive: true });
      await fs.writeFile(promptPath, req.body.content, 'utf-8');
      const stats = await fs.stat(promptPath);
      return { ok: true, updatedAt: stats.mtime.toISOString() };
    } catch (error) {
      return reply.status(400).send({ error: String(error) });
    }
  });

  // Get logs (historical)
  app.get<{ Params: { id: string }; Querystring: { since?: string } }>(
    '/api/jobs/:id/logs',
    async (req, reply) => {
      const job = jobQueue.get(req.params.id);
      if (!job) return reply.status(404).send({ error: 'Not found' });
      const since = req.query.since ? Number(req.query.since) : undefined;
      return dbGetLogs(req.params.id, since);
    },
  );

  // List profiles
  app.get('/api/profiles', async () => dbListProfiles());
  app.get('/api/advanced-profiles', async () => ADVANCED_SETTINGS_PROFILES);

  // WebSocket log stream
  app.get<{ Params: { id: string } }>(
    '/ws/jobs/:id/logs',
    { websocket: true },
    (socket, req) => {
      const { id } = req.params;
      const job = jobQueue.get(id);
      if (!job) { socket.close(1008, 'Job not found'); return; }

      // Send buffered logs first
      const buffered = dbGetLogs(id);
      for (const e of buffered) socket.send(JSON.stringify(e));

      const unsub = jobQueue.subscribe(id, event => {
        if (socket.readyState === 1 /* OPEN */) socket.send(JSON.stringify(event));
      });

      socket.on('close', unsub);
    },
  );
}
