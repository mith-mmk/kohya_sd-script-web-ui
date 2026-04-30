import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.resolve(__dirname, '../../../.env'));

const { jobRoutes } = await import('./routes/jobs.js');

const app = Fastify({
  logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  // Allow POST routes that send no body (e.g. /start, /stop, /resume)
  ajv: { customOptions: { allowUnionTypes: true } },
});
app.setErrorHandler((error, req, reply) => {
  req.log.error(error);
  const err = error as Error & { code?: string };
  reply.status(500).send({
    error: err.message,
    code: err.code,
  });
});
// Allow empty body on any content-type — prevents FST_ERR_CTP_EMPTY_JSON_BODY
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (!body || (body as string).trim() === '') { done(null, {}); return; }
  try { done(null, JSON.parse(body as string)); }
  catch (err) { done(err as Error, undefined); }
});

await app.register(cors, { origin: true });
await app.register(websocket);

// Serve built web UI (production)
const webDistDir = path.resolve(__dirname, '../../web/dist');
try {
  await app.register(staticFiles, { root: webDistDir, prefix: '/' });
} catch { /* web/dist may not exist in dev — Vite handles this */ }

await app.register(jobRoutes);

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '127.0.0.1';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;

  const envText = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of envText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(separatorIndex + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`[kohya-server] listening on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
