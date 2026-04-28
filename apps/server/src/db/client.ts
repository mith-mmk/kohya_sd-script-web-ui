import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCHEMA_SQL } from './schema.js';
import type { TrainJob, LogEvent, LoRAProfile, DatasetSnapshot, WorkflowManifest } from '../types/job.js';
import { DEFAULT_PROFILES } from '../types/job.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(process.env['DB_PATH'] ?? path.join(__dirname, '../../../../data/kohya.db'));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.exec(SCHEMA_SQL);
    seedDefaultProfiles(_db);
  }
  return _db;
}

function seedDefaultProfiles(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO profiles (id, name, description, params_json, locked_fields_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const p of DEFAULT_PROFILES) {
    insert.run(p.id, p.name, p.description ?? '', JSON.stringify(p.params), JSON.stringify(p.lockedFields), now);
  }
}

// ─── Job helpers ─────────────────────────────────────────────────────────────

export function dbInsertJob(job: TrainJob): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO jobs (id, name, status, current_phase, model_type, work_dir, state_dir,
      input_json, preprocess_json, params_json, error_message, retry_count, snapshot_id,
      created_at, updated_at, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id, job.name, job.status, job.currentPhase, job.modelType, job.workDir,
    job.stateDir ?? null,
    JSON.stringify(job.input), JSON.stringify(job.preprocessOptions),
    JSON.stringify(job.params), job.errorMessage ?? null, job.retryCount,
    job.snapshotId ?? null, job.createdAt, job.updatedAt, job.startedAt ?? null, job.completedAt ?? null,
  );
}

export function dbUpdateJob(id: string, fields: Partial<TrainJob>): void {
  const db = getDb();
  const updates: string[] = ['updated_at = ?'];
  const values: unknown[] = [new Date().toISOString()];

  const colMap: Record<string, string> = {
    status: 'status', currentPhase: 'current_phase', stateDir: 'state_dir',
    errorMessage: 'error_message', retryCount: 'retry_count', snapshotId: 'snapshot_id',
    startedAt: 'started_at', completedAt: 'completed_at',
  };

  for (const [k, col] of Object.entries(colMap)) {
    if (k in fields) {
      updates.push(`${col} = ?`);
      values.push((fields as Record<string, unknown>)[k] ?? null);
    }
  }
  if (fields.params) {
    updates.push('params_json = ?');
    values.push(JSON.stringify(fields.params));
  }

  values.push(id);
  db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

export function dbGetJob(id: string): TrainJob | null {
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export function dbListJobs(): TrainJob[] {
  const rows = getDb().prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(rowToJob);
}

export function dbDeleteJob(id: string): void {
  const db = getDb();
  const tx = db.transaction((jobId: string) => {
    db.prepare('DELETE FROM job_logs WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM dataset_snapshots WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM workflow_manifests WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  });
  tx(id);
}

function rowToJob(row: Record<string, unknown>): TrainJob {
  const id = row['id'] as string;
  return {
    id,
    name: row['name'] as string,
    status: row['status'] as TrainJob['status'],
    currentPhase: row['current_phase'] as TrainJob['currentPhase'],
    modelType: row['model_type'] as TrainJob['modelType'],
    workDir: row['work_dir'] as string,
    stateDir: (row['state_dir'] as string | null) ?? undefined,
    input: JSON.parse(row['input_json'] as string),
    preprocessOptions: JSON.parse(row['preprocess_json'] as string),
    params: JSON.parse(row['params_json'] as string),
    manifest: dbGetWorkflowManifest(id) ?? undefined,
    errorMessage: (row['error_message'] as string | null) ?? undefined,
    retryCount: row['retry_count'] as number,
    snapshotId: (row['snapshot_id'] as string | null) ?? undefined,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    startedAt: (row['started_at'] as string | null) ?? undefined,
    completedAt: (row['completed_at'] as string | null) ?? undefined,
  };
}

export function dbUpsertWorkflowManifest(manifest: WorkflowManifest): void {
  getDb().prepare(`
    INSERT INTO workflow_manifests (job_id, manifest_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      manifest_json = excluded.manifest_json,
      updated_at = excluded.updated_at
  `).run(manifest.jobId, JSON.stringify(manifest), manifest.updatedAt);
}

export function dbGetWorkflowManifest(jobId: string): WorkflowManifest | null {
  const row = getDb().prepare('SELECT manifest_json FROM workflow_manifests WHERE job_id = ?').get(jobId) as Record<string, unknown> | undefined;
  return row ? JSON.parse(row['manifest_json'] as string) as WorkflowManifest : null;
}

// ─── Log helpers ─────────────────────────────────────────────────────────────

export function dbInsertLog(event: LogEvent): void {
  getDb().prepare(`
    INSERT INTO job_logs (job_id, ts, type, level, message, data_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(event.jobId, event.ts, event.type, event.level, event.message, event.data ? JSON.stringify(event.data) : null);
}

export function dbGetLogs(jobId: string, sinceTs?: number): LogEvent[] {
  const rows = sinceTs
    ? getDb().prepare('SELECT * FROM job_logs WHERE job_id = ? AND ts > ? ORDER BY id').all(jobId, sinceTs)
    : getDb().prepare('SELECT * FROM job_logs WHERE job_id = ? ORDER BY id').all(jobId);

  return (rows as Record<string, unknown>[]).map(r => ({
    jobId: r['job_id'] as string,
    ts: r['ts'] as number,
    type: r['type'] as LogEvent['type'],
    level: r['level'] as LogEvent['level'],
    message: r['message'] as string,
    data: r['data_json'] ? JSON.parse(r['data_json'] as string) : undefined,
  }));
}

// ─── Profile helpers ──────────────────────────────────────────────────────────

export function dbListProfiles(): LoRAProfile[] {
  const rows = getDb().prepare('SELECT * FROM profiles').all() as Record<string, unknown>[];
  return rows.map(r => ({
    id: r['id'] as string,
    name: r['name'] as string,
    description: (r['description'] as string) ?? '',
    params: JSON.parse(r['params_json'] as string),
    lockedFields: JSON.parse(r['locked_fields_json'] as string),
  }));
}

export function dbGetProfile(id: string): LoRAProfile | null {
  const row = getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    description: (row['description'] as string) ?? '',
    params: JSON.parse(row['params_json'] as string),
    lockedFields: JSON.parse(row['locked_fields_json'] as string),
  };
}

// ─── Snapshot helpers ─────────────────────────────────────────────────────────

export function dbInsertSnapshot(snap: DatasetSnapshot): void {
  getDb().prepare(`
    INSERT INTO dataset_snapshots (id, job_id, version, image_list_json, tags_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(snap.id, snap.jobId, snap.version, JSON.stringify(snap.imageList), snap.tagsHash, snap.createdAt);
}

export function dbGetLatestSnapshot(jobId: string): DatasetSnapshot | null {
  const row = getDb().prepare(
    'SELECT * FROM dataset_snapshots WHERE job_id = ? ORDER BY version DESC LIMIT 1'
  ).get(jobId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row['id'] as string,
    jobId: row['job_id'] as string,
    version: row['version'] as number,
    imageList: JSON.parse(row['image_list_json'] as string),
    tagsHash: row['tags_hash'] as string,
    createdAt: row['created_at'] as string,
  };
}
