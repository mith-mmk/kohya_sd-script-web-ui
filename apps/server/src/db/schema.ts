export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued',
  current_phase  TEXT NOT NULL DEFAULT 'preprocess',
  model_type     TEXT NOT NULL,
  work_dir       TEXT NOT NULL,
  state_dir      TEXT,
  input_json     TEXT NOT NULL,
  preprocess_json TEXT NOT NULL,
  params_json    TEXT NOT NULL,
  error_message  TEXT,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  snapshot_id    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  started_at     TEXT,
  completed_at   TEXT
);

CREATE TABLE IF NOT EXISTS job_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id   TEXT    NOT NULL,
  ts       INTEGER NOT NULL,
  type     TEXT    NOT NULL,
  level    TEXT    NOT NULL,
  message  TEXT    NOT NULL,
  data_json TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS profiles (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT,
  params_json        TEXT NOT NULL,
  locked_fields_json TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_snapshots (
  id               TEXT PRIMARY KEY,
  job_id           TEXT NOT NULL,
  version          INTEGER NOT NULL,
  image_list_json  TEXT NOT NULL,
  tags_hash        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`;
