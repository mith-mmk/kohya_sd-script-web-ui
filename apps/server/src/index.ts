import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobRoutes } from './routes/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  // Allow POST routes that send no body (e.g. /start, /stop, /resume)
  ajv: { customOptions: { allowUnionTypes: true } },
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
const webDistDir = path.resolve(__dirname, '../../../web/dist');
try {
  await app.register(staticFiles, { root: webDistDir, prefix: '/' });
} catch { /* web/dist may not exist in dev — Vite handles this */ }

await app.register(jobRoutes);

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '127.0.0.1';

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`[kohya-server] listening on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
