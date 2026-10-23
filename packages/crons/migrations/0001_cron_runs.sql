CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  dispatch_id TEXT,
  phase TEXT NOT NULL,
  job_name TEXT NOT NULL,
  cron TEXT NOT NULL,
  scheduled_time INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  attempt INTEGER,
  items_processed INTEGER,
  project TEXT,
  deployment TEXT,
  error_name TEXT,
  error_message TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cron_runs_run_id ON cron_runs (run_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cron_runs_occurred_at ON cron_runs (occurred_at DESC);
