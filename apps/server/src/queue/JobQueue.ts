import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import type { ModelType, TrainJob, TrainJobInput, PreprocessOptions, TrainParams, LogEvent, RetryConfig, WorkflowManifest, WorkflowStepId } from '../types/job.js';
import { ADVANCED_SETTINGS_PROFILES, conservativeOverride, defaultPreprocessOptions } from '../types/job.js';
import {
  dbDeleteJob, dbInsertJob, dbUpdateJob, dbGetJob, dbListJobs, dbInsertLog, dbGetProfile, dbUpsertWorkflowManifest,
} from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = path.resolve(process.env['BRIDGE_DIR'] ?? path.join(__dirname, '../../../../python/bridge'));
const SD_SCRIPTS_DIR = path.resolve(process.env['SD_SCRIPTS_DIR'] ?? path.join(__dirname, '../../../../sd-scripts'));
const WORK_BASE = path.resolve(process.env['WORK_BASE'] ?? path.join(__dirname, '../../../../work'));
const PYTHON_BIN = process.env['PYTHON_BIN'] ?? 'python';
const UTF8_PYTHON_ENV = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } as const;
const PREPARE_BUCKETS_UNSUPPORTED = new Set<ModelType>(['flux', 'anima']);
const MODEL_REQUIRED_PATH_FIELDS: Partial<Record<ModelType, Array<keyof TrainParams>>> = {
  flux: ['clipL', 't5xxl', 'ae'],
  anima: ['qwen3', 'vae'],
};
const MODEL_OPTIONAL_PATH_FIELDS: Partial<Record<ModelType, Array<keyof TrainParams>>> = {
  anima: ['t5TokenizerPath', 'llmAdapterPath'],
};
const MODEL_PATH_LABELS: Partial<Record<keyof TrainParams, string>> = {
  clipL: 'FLUX CLIP-L path',
  t5xxl: 'FLUX T5XXL path',
  ae: 'FLUX AE path',
  qwen3: 'Anima Qwen3 path',
  vae: 'Anima VAE path',
  t5TokenizerPath: 'Anima T5 tokenizer path',
  llmAdapterPath: 'Anima LLM adapter path',
};

type LogListener = (event: LogEvent) => void;
const WORKFLOW_STEPS: Array<{ id: WorkflowStepId; name: string }> = [
  { id: 'image-normalize', name: 'Image normalization' },
  { id: 'resize', name: 'Resize/crop' },
  { id: 'tagger', name: 'Tagger' },
  { id: 'caption', name: 'Captioning' },
  { id: 'merge-metadata', name: 'Merge metadata' },
  { id: 'bucket-cache', name: 'Bucket/latent cache' },
  { id: 'dataset-config', name: 'Dataset config' },
  { id: 'train', name: 'Training' },
];

class JobQueue {
  private processes = new Map<string, ChildProcess>();
  private listeners = new Map<string, Set<LogListener>>();

  // ─── Subscribe to live logs ─────────────────────────────────────────────────
  subscribe(jobId: string, fn: LogListener): () => void {
    if (!this.listeners.has(jobId)) this.listeners.set(jobId, new Set());
    this.listeners.get(jobId)!.add(fn);
    return () => this.listeners.get(jobId)?.delete(fn);
  }

  private emit(event: LogEvent): void {
    dbInsertLog(event);
    this.listeners.get(event.jobId)?.forEach(fn => fn(event));
  }

  private sysLog(jobId: string, level: LogEvent['level'], message: string): void {
    this.emit({ jobId, ts: Date.now(), type: 'system', level, message });
  }

  // ─── Create job ─────────────────────────────────────────────────────────────
  createJob(
    input: TrainJobInput,
    preprocessOptions?: Partial<PreprocessOptions>,
  ): TrainJob {
    const normalizedInput = normalizeTrainJobInput(input);
    const advancedProfile = ADVANCED_SETTINGS_PROFILES.find(profile => profile.id === normalizedInput.advancedProfileId);
    const resolvedPreprocessOptions = resolvePreprocessOptions(normalizedInput.modelType, {
      ...(advancedProfile?.preprocessOptions ?? {}),
      ...(preprocessOptions ?? {}),
    });
    const resolvedSdScriptsDir = resolveSdScriptsDir(normalizedInput);
    const id = uuidv4();
    const now = new Date().toISOString();

    // Resolve parameters from profile + overrides
    const profile = normalizedInput.profileId ? dbGetProfile(normalizedInput.profileId) : null;
    const baseParams: TrainParams = profile ? { ...profile.params } : getDefaultParams(normalizedInput.modelType);
    const lockedFields = new Set(profile?.lockedFields ?? []);
    const resolved: TrainParams = { ...baseParams };
    if (advancedProfile?.params) {
      Object.assign(resolved, advancedProfile.params);
    }
    if (normalizedInput.overrides) {
      for (const [k, v] of Object.entries(normalizedInput.overrides)) {
        if (!lockedFields.has(k as keyof TrainParams)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (resolved as any)[k] = v;
        }
      }
    }

    validateInputForLaunch(normalizedInput, resolvedPreprocessOptions, resolved, resolvedSdScriptsDir);

    fs.mkdirSync(normalizedInput.outputDir, { recursive: true });
    const workDir = path.join(resolveWorkBaseDir(normalizedInput), id);
    fs.mkdirSync(workDir, { recursive: true });
    const manifest = createWorkflowManifest(id, workDir, normalizedInput.trainerType ?? 'lora');

    const job: TrainJob = {
      id, name: input.name, status: 'queued', currentPhase: 'preprocess',
      modelType: normalizedInput.modelType, workDir, input: normalizedInput,
      preprocessOptions: resolvedPreprocessOptions,
      params: resolved,
      manifest,
      retryCount: 0, createdAt: now, updatedAt: now,
    };
    dbInsertJob(job);
    dbUpsertWorkflowManifest(manifest);
    return job;
  }

  // ─── Start / enqueue job ────────────────────────────────────────────────────
  async startJob(jobId: string, retryConfig?: RetryConfig): Promise<void> {
    const job = dbGetJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (this.processes.has(jobId)) throw new Error(`Job ${jobId} already running`);

    const normalizedInput = normalizeTrainJobInput(job.input);
    const resolvedSdScriptsDir = resolveSdScriptsDir(normalizedInput);
    validateInputForLaunch(normalizedInput, job.preprocessOptions, job.params, resolvedSdScriptsDir);
    fs.mkdirSync(normalizedInput.outputDir, { recursive: true });

    const now = new Date().toISOString();
    dbUpdateJob(jobId, { status: 'running', startedAt: now });
    this.sysLog(jobId, 'info', `Starting job "${job.name}" [${job.modelType}]`);

    // Write job config to workDir for bridge to read
    const configPath = path.join(job.workDir, 'job_config.json');
    const bridgeConfig = {
      jobId, modelType: job.modelType,
      baseModelPath: normalizedInput.baseModelPath,
      datasetDir: normalizedInput.datasetDir,
      outputDir: normalizedInput.outputDir,
      outputName: normalizedInput.outputName,
      workDir: job.workDir,
      sdScriptsDir: resolvedSdScriptsDir,
      datasetSubsets: normalizedInput.datasetSubsets,
      triggerWord: normalizedInput.triggerWord?.trim() || null,
      repeatCount: normalizedInput.repeatCount ?? 10,
      preprocessOptions: job.preprocessOptions,
      params: job.params,
      resume: retryConfig?.stateDir ?? job.stateDir ?? null,
      resumeFromStep: retryConfig?.resumeFromStep ?? job.manifest?.resumeFromStep ?? null,
      paramsOverride: retryConfig?.paramsOverride ?? null,
      retryTier: retryConfig?.tier ?? null,
      pauseBeforeTraining: Boolean(normalizedInput.pauseBeforeTraining) && !retryConfig?.skipPause,
    };
    fs.writeFileSync(configPath, JSON.stringify(bridgeConfig, null, 2), 'utf-8');
    this.updateManifestStep(jobId, retryConfig?.resumeFromStep ?? 'image-normalize', 'running');

    const proc = spawn(PYTHON_BIN, [
      path.join(BRIDGE_DIR, 'runner.py'),
      '--config', configPath,
    ], {
      cwd: job.workDir,
      env: { ...process.env, ...UTF8_PYTHON_ENV },
    });

    this.processes.set(jobId, proc);

    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as LogEvent & { exitCode?: number };
          if (event.type === 'exit') {
            this.handleExit(jobId, event.data?.exitCode ?? -1, event.message);
          } else {
            this.emit({ ...event, jobId });
          }
        } catch {
          this.emit({ jobId, ts: Date.now(), type: 'stdout', level: 'info', message: trimmed });
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.emit({ jobId, ts: Date.now(), type: 'stderr', level: 'warn', message: text });
    });

    proc.on('error', err => {
      this.emit({ jobId, ts: Date.now(), type: 'system', level: 'error', message: `Process error: ${err.message}` });
      this.handleExit(jobId, 1, err.message);
    });

    proc.on('close', code => {
      if (this.processes.has(jobId)) {
        this.handleExit(jobId, code ?? -1, code === 0 ? 'Process completed' : `Exited with code ${code}`);
      }
    });
  }

  private handleExit(jobId: string, code: number, message: string): void {
    this.processes.delete(jobId);
    const job = dbGetJob(jobId);
    if (!job || job.status === 'completed') return;

    if (code === 2) {
      this.markStepsCompletedThrough(jobId, 'dataset-config');
      dbUpdateJob(jobId, { status: 'paused', currentPhase: 'train', errorMessage: undefined });
      this.sysLog(jobId, 'info', 'Paused before training. Review parameters and tags, then continue.');
    } else if (code === 0) {
      this.updateManifestStep(jobId, 'train', 'completed');
      dbUpdateJob(jobId, { status: 'completed', currentPhase: 'done', completedAt: new Date().toISOString() });
      this.sysLog(jobId, 'info', `Job completed successfully`);
    } else {
      const nextTier = this.getNextRetryTier(job);
      this.updateManifestStep(jobId, 'train', 'failed', message);
      if (nextTier) {
        dbUpdateJob(jobId, { status: 'resumable', errorMessage: message, retryCount: job.retryCount + 1 });
        this.sysLog(jobId, 'warn', `Job failed (tier ${nextTier} available). Click Resume to retry.`);
      } else {
        dbUpdateJob(jobId, { status: 'failed', errorMessage: message });
        this.sysLog(jobId, 'error', `Job failed: ${message}`);
      }
    }
  }

  // ─── Resume with staged retry ───────────────────────────────────────────────
  async resumeJob(jobId: string): Promise<void> {
    const job = dbGetJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const tier = this.getNextRetryTier(job);
    if (!tier) throw new Error(`No retry tier available for job ${jobId}`);

    const retryConfig = await this.buildRetryConfig(job, tier);
    this.sysLog(jobId, 'info', `Resuming with tier: ${tier}`);
    await this.startJob(jobId, retryConfig);
  }

  async continueJob(jobId: string): Promise<void> {
    const job = dbGetJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status !== 'paused') throw new Error(`Job ${jobId} is not paused`);
    this.sysLog(jobId, 'info', 'Continuing from paused training gate');
    await this.startJob(jobId, { tier: 'latest-state', resumeFromStep: 'train', skipPause: true });
  }

  private getNextRetryTier(job: TrainJob): RetryConfig['tier'] | null {
    const states = this.discoverStateDirs(job);
    switch (job.retryCount) {
      case 0: return states.length > 0 ? 'latest-state' : 'model-conservative';
      case 1: return states.length > 1 ? 'prev-state' : 'model-conservative';
      case 2: return 'model-conservative';
      default: return null;
    }
  }

  private async buildRetryConfig(job: TrainJob, tier: RetryConfig['tier']): Promise<RetryConfig> {
    const states = this.discoverStateDirs(job);
    const resumeFromStep = job.manifest?.resumeFromStep ?? 'train';
    switch (tier) {
      case 'latest-state':
        return { tier, stateDir: states[0], resumeFromStep };
      case 'prev-state':
        return { tier, stateDir: states[1] ?? states[0], resumeFromStep };
      case 'model-conservative':
        return { tier, resumeFromStep, paramsOverride: conservativeOverride };
    }
  }

  /** Discover state dirs in outputDir, sorted newest-first */
  private discoverStateDirs(job: TrainJob): string[] {
    const outDir = job.input.outputDir;
    if (!fs.existsSync(outDir)) return [];
    const entries = fs.readdirSync(outDir, { withFileTypes: true });
    const pattern = /^.+-\d{6}-state$|^.+-step\d{8}-state$/;
    return entries
      .filter(e => e.isDirectory() && pattern.test(e.name))
      .map(e => path.join(outDir, e.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  }

  // ─── Stop job ───────────────────────────────────────────────────────────────
  stopJob(jobId: string): void {
    const proc = this.processes.get(jobId);
    if (proc) {
      proc.kill('SIGTERM');
      this.processes.delete(jobId);
      this.updateManifestStep(jobId, 'train', 'failed', 'Stopped by user');
      dbUpdateJob(jobId, { status: 'resumable' });
      this.sysLog(jobId, 'warn', 'Job stopped by user');
    }
  }

  deleteJob(jobId: string): void {
    const job = dbGetJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (this.processes.has(jobId) || job.status === 'running') {
      throw new Error(`Job ${jobId} is still running`);
    }

    this.listeners.delete(jobId);
    dbDeleteJob(jobId);

    if (job.workDir && fs.existsSync(job.workDir)) {
      fs.rmSync(job.workDir, { recursive: true, force: true });
    }
  }

  // ─── Update dataset (fine-tune loop) ────────────────────────────────────────
  updateDatasetConfig(jobId: string, updates: {
    addImages?: string[];
    removeImages?: string[];
    params?: Partial<TrainParams>;
  }): TrainJob {
    const job = dbGetJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (updates.params) dbUpdateJob(jobId, { params: { ...job.params, ...updates.params } });
    this.sysLog(jobId, 'info', `Dataset config updated: ${JSON.stringify(updates)}`);
    return dbGetJob(jobId)!;
  }

  updateParams(jobId: string, params: Partial<TrainParams>): TrainJob {
    const job = dbGetJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status === 'running') throw new Error('Cannot edit parameters while the job is running');
    const nextParams = { ...job.params, ...params };
    validateModelPaths(job.modelType, nextParams);
    dbUpdateJob(jobId, { params: nextParams });
    this.sysLog(jobId, 'info', 'Training parameters updated');
    return dbGetJob(jobId)!;
  }

  list(): TrainJob[] { return dbListJobs(); }
  get(id: string): TrainJob | null { return dbGetJob(id); }

  private updateManifestStep(jobId: string, stepId: WorkflowStepId, status: 'running' | 'completed' | 'failed', errorMessage?: string): void {
    const job = dbGetJob(jobId);
    const manifest = job?.manifest;
    if (!manifest) return;
    const step = manifest.steps.find(item => item.id === stepId);
    if (!step) return;
    const now = new Date().toISOString();
    if (status === 'running') step.startedAt = step.startedAt ?? now;
    if (status === 'completed' || status === 'failed') step.endedAt = now;
    step.status = status;
    step.error = errorMessage;
    if (status === 'failed') manifest.resumeFromStep = stepId;
    if (status === 'completed' && manifest.resumeFromStep === stepId) manifest.resumeFromStep = undefined;
    manifest.updatedAt = now;
    dbUpsertWorkflowManifest(manifest);
  }

  private markStepsCompletedThrough(jobId: string, stepId: WorkflowStepId): void {
    const job = dbGetJob(jobId);
    const manifest = job?.manifest;
    if (!manifest) return;
    const targetIndex = manifest.steps.findIndex(item => item.id === stepId);
    if (targetIndex < 0) return;
    const now = new Date().toISOString();
    manifest.steps.forEach((step, index) => {
      if (index <= targetIndex && step.status !== 'skipped') {
        step.status = 'completed';
        step.startedAt = step.startedAt ?? now;
        step.endedAt = step.endedAt ?? now;
        step.error = undefined;
      }
    });
    manifest.resumeFromStep = 'train';
    manifest.updatedAt = now;
    dbUpsertWorkflowManifest(manifest);
  }
}

// Singleton
export const jobQueue = new JobQueue();

function normalizeTrainJobInput(input: TrainJobInput): TrainJobInput {
  const overrides = input.overrides
    ? Object.fromEntries(
      Object.entries(input.overrides).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
    ) as Partial<TrainParams>
    : undefined;
  const datasetSubsets = (input.datasetSubsets ?? [])
    .map(subset => {
      const imageDir = subset.imageDir.trim();
      if (!imageDir) return null;
      const triggerWord = subset.triggerWord?.trim() || undefined;
      const repeatCount = Math.max(1, Number(subset.repeatCount) || 10);
      return { imageDir, triggerWord, repeatCount };
    })
    .filter((subset): subset is NonNullable<typeof subset> => subset !== null);

  const fallbackDatasetDir = input.datasetDir.trim();
  if (!datasetSubsets.length && fallbackDatasetDir) {
    datasetSubsets.push({
      imageDir: fallbackDatasetDir,
      triggerWord: input.triggerWord?.trim() || undefined,
      repeatCount: Math.max(1, Number(input.repeatCount) || 10),
    });
  }

  const primarySubset = datasetSubsets[0];
  return {
    ...input,
    trainerType: input.trainerType ?? 'lora',
    pauseBeforeTraining: Boolean(input.pauseBeforeTraining),
    name: input.name.trim(),
    baseModelPath: input.baseModelPath.trim(),
    datasetDir: primarySubset?.imageDir ?? fallbackDatasetDir,
    datasetSubsets,
    outputDir: input.outputDir.trim(),
    outputName: input.outputName.trim(),
    workBaseDir: input.workBaseDir?.trim() || undefined,
    profileId: input.profileId?.trim() || undefined,
    advancedProfileId: input.advancedProfileId?.trim() || 'balanced',
    sdScriptsDir: input.sdScriptsDir?.trim() || undefined,
    triggerWord: primarySubset?.triggerWord ?? (input.triggerWord?.trim() || undefined),
    repeatCount: primarySubset?.repeatCount ?? Math.max(1, Number(input.repeatCount) || 10),
    overrides,
  };
}

function resolveWorkBaseDir(input: TrainJobInput): string {
  return input.workBaseDir?.trim()
    ? path.resolve(input.workBaseDir)
    : WORK_BASE;
}

function createWorkflowManifest(jobId: string, workDir: string, trainerType: NonNullable<TrainJobInput['trainerType']>): WorkflowManifest {
  const now = new Date().toISOString();
  return {
    version: 1,
    jobId,
    trainerType,
    workDir,
    createdAt: now,
    updatedAt: now,
    steps: WORKFLOW_STEPS.map(step => ({
      ...step,
      status: 'pending',
      outputs: [],
    })),
  };
}

function resolveSdScriptsDir(input: TrainJobInput): string {
  return input.sdScriptsDir?.trim()
    ? path.resolve(input.sdScriptsDir)
    : SD_SCRIPTS_DIR;
}

function resolvePreprocessOptions(
  modelType: ModelType,
  preprocessOptions?: Partial<PreprocessOptions>,
): PreprocessOptions {
  const resolved = { ...defaultPreprocessOptions, ...preprocessOptions };
  validatePreprocessOptions(modelType, resolved);
  return resolved;
}

function validateInputForLaunch(
  input: TrainJobInput,
  preprocessOptions: PreprocessOptions,
  params: TrainParams,
  resolvedSdScriptsDir: string,
): void {
  const datasetSubsets = input.datasetSubsets ?? [];

  if (!input.name) throw new Error('Job name is required');
  if (!input.baseModelPath) throw new Error('Base model path is required');
  if (!input.outputDir) throw new Error('Output directory is required');
  if (!input.outputName) throw new Error('Output name is required');
  if (!datasetSubsets.length) throw new Error('At least one dataset subset is required');

  validatePreprocessOptions(input.modelType, preprocessOptions);
  validateExistingDirectory('sd-scripts directory', resolvedSdScriptsDir);

  for (const subset of datasetSubsets) {
    validateConfiguredDirectory('Dataset subset directory', subset.imageDir);
  }

  validateModelPaths(input.modelType, params);
}

function validatePreprocessOptions(modelType: ModelType, preprocessOptions: PreprocessOptions): void {
  if (preprocessOptions.runPrepareBuckets && PREPARE_BUCKETS_UNSUPPORTED.has(modelType)) {
    throw new Error(`Prepare buckets is not supported for ${modelType} jobs`);
  }
}

function validateModelPaths(modelType: ModelType, params: TrainParams): void {
  const requiredFields = MODEL_REQUIRED_PATH_FIELDS[modelType] ?? [];
  const optionalFields = MODEL_OPTIONAL_PATH_FIELDS[modelType] ?? [];

  for (const field of requiredFields) {
    const value = getStringParam(params, field);
    if (!value) {
      throw new Error(`${MODEL_PATH_LABELS[field] ?? String(field)} is required for ${modelType} jobs`);
    }
    validateConfiguredPath(MODEL_PATH_LABELS[field] ?? String(field), value);
  }

  for (const field of optionalFields) {
    const value = getStringParam(params, field);
    if (value) {
      validateConfiguredPath(MODEL_PATH_LABELS[field] ?? String(field), value);
    }
  }
}

function getStringParam(params: TrainParams, field: keyof TrainParams): string | undefined {
  const value = params[field];
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

function validateExistingDirectory(label: string, targetPath: string): void {
  validateExistingPath(label, targetPath);
  if (!fs.statSync(targetPath).isDirectory()) {
    throw new Error(`${label} is not a directory: ${targetPath}`);
  }
}

function validateConfiguredDirectory(label: string, targetPath: string): void {
  if (!path.isAbsolute(targetPath)) return;
  validateExistingDirectory(label, targetPath);
}

function validateConfiguredPath(label: string, targetPath: string): void {
  if (!path.isAbsolute(targetPath)) return;
  validateExistingPath(label, targetPath);
}

function validateExistingPath(label: string, targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

// ─── Parameter defaults by model ─────────────────────────────────────────────
function getDefaultParams(modelType: string): TrainParams {
  const base: TrainParams = {
    networkDim: 32, networkAlpha: 16, learningRate: 1e-4,
    batchSize: 2, maxTrainEpochs: 10, optimizerType: 'AdamW8bit',
    lrScheduler: 'cosine_with_restarts', mixedPrecision: 'fp16',
    gradientCheckpointing: true, cacheLatents: true, cacheLatentsToDisk: false,
    saveEveryNEpochs: 2, saveLastNEpochs: 3, saveState: true, saveModelAs: 'safetensors',
  };
  if (modelType === 'sdxl') return { ...base, networkDim: 64, networkAlpha: 32, mixedPrecision: 'bf16', cacheLatentsToDisk: true };
  if (modelType === 'flux') return { ...base, networkDim: 16, networkAlpha: 8, batchSize: 1, mixedPrecision: 'bf16', cacheLatentsToDisk: true };
  if (modelType === 'anima') return { ...base, batchSize: 1, mixedPrecision: 'bf16', cacheLatentsToDisk: true };
  return base;
}
