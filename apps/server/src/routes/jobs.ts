import type { FastifyInstance } from 'fastify';
import { jobQueue } from '../queue/JobQueue.js';
import type { TrainJobInput, PreprocessOptions } from '../types/job.js';
import { dbGetLogs, dbListProfiles } from '../db/client.js';

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

  // Resume job (staged retry)
  app.post<{ Params: { id: string } }>('/api/jobs/:id/resume', async (req, reply) => {
    try {
      await jobQueue.resumeJob(req.params.id);
      return { ok: true };
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
