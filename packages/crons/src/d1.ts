import {
  cronRunToLedgerEvent,
  sanitizeCronErrorSummary,
  type CronErrorSummary,
  type CronLedgerEvent,
  type CronLedgerStore,
  type CronRunStore,
} from "./runtime.js";

export interface D1RunResult {
  success?: boolean;
  meta?: { changes?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<D1RunResult>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export interface D1CronStoreOptions {
  db: D1DatabaseLike;
  /** Defaults to `cron_runs`. Validated as a SQL identifier. */
  table?: string;
  /** Defaults to 30 days. Set `0` to disable automatic retention. */
  retentionMs?: number;
  now?: () => number;
}

export interface D1CronStore extends CronRunStore, CronLedgerStore {
  ensureSchema(): Promise<void>;
  has(id: string): Promise<boolean>;
  get(id: string): Promise<CronLedgerEvent | null>;
  list(limit?: number): Promise<CronLedgerEvent[]>;
  listByRun(runId: string, limit?: number): Promise<CronLedgerEvent[]>;
  prune(now?: number): Promise<number>;
}

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertTable(table: string): string {
  if (!TABLE_PATTERN.test(table)) throw new Error(`invalid D1 cron table name: ${table}`);
  return table;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0 && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function rowToEvent(row: Record<string, unknown>): CronLedgerEvent | null {
  if (typeof row["id"] !== "string" || typeof row["run_id"] !== "string" || typeof row["phase"] !== "string") {
    return null;
  }
  const scheduledTime = toNumber(row["scheduled_time"]);
  const occurredAt = toNumber(row["occurred_at"]);
  if (scheduledTime === undefined || occurredAt === undefined) return null;
  const event: CronLedgerEvent = {
    id: row["id"],
    runId: row["run_id"],
    phase: row["phase"] as CronLedgerEvent["phase"],
    jobName: String(row["job_name"] ?? ""),
    cron: String(row["cron"] ?? ""),
    scheduledTime,
    occurredAt,
    status: (row["status"] as CronLedgerEvent["status"]) ?? "unknown",
  };
  if (typeof row["dispatch_id"] === "string") event.dispatchId = row["dispatch_id"];
  for (const [column, key] of [
    ["started_at", "startedAt"],
    ["finished_at", "finishedAt"],
    ["duration_ms", "durationMs"],
    ["attempt", "attempt"],
    ["items_processed", "itemsProcessed"],
  ] as const) {
    const value = toNumber(row[column]);
    if (value !== undefined) event[key] = value;
  }
  if (typeof row["project"] === "string") event.project = row["project"];
  if (typeof row["deployment"] === "string") event.deployment = row["deployment"];
  if (typeof row["error_name"] === "string" || typeof row["error_message"] === "string") {
    const summary: CronErrorSummary = {
      name: typeof row["error_name"] === "string" ? row["error_name"] : "Error",
      message: typeof row["error_message"] === "string" ? row["error_message"] : "",
    };
    if (typeof row["error_code"] === "string") summary.code = row["error_code"];
    event.error = summary;
  }
  return event;
}

/**
 * Worker-safe D1 ledger. The consumer app owns the D1 binding, migration, and
 * authorization. This adapter only writes bounded, redacted records.
 */
export function createD1CronStore(options: D1CronStoreOptions): D1CronStore {
  const table = assertTable(options.table ?? "cron_runs");
  const now = options.now ?? Date.now;
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  let schemaReady: Promise<void> | undefined;
  let ready = false;

  const requireSchema = (): void => {
    if (!ready) {
      throw new Error("D1 cron store schema is not initialized; call ensureSchema() or apply migrations/0001_cron_runs.sql");
    }
  };

  const ensureSchema = (): Promise<void> => {
    if (!schemaReady) {
      schemaReady = (async () => {
        const statements = [
          `CREATE TABLE IF NOT EXISTS ${table} (
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
          )`,
          `CREATE INDEX IF NOT EXISTS ${table}_run_id ON ${table} (run_id, occurred_at DESC)`,
          `CREATE INDEX IF NOT EXISTS ${table}_occurred_at ON ${table} (occurred_at DESC)`,
        ];
        for (const statement of statements) await options.db.prepare(statement).run();
        ready = true;
      })().catch((error) => {
        schemaReady = undefined;
        ready = false;
        throw error;
      });
    }
    return schemaReady;
  };

  const recordEvent = async (event: CronLedgerEvent): Promise<void> => {
    requireSchema();
    const error = sanitizeCronErrorSummary(event.error) ?? null;
    await options.db
      .prepare(
        `INSERT INTO ${table}
          (id, run_id, dispatch_id, phase, job_name, cron, scheduled_time, occurred_at,
           started_at, finished_at, duration_ms, status, attempt, items_processed,
           project, deployment, error_name, error_message, error_code, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        event.id,
        event.runId,
        event.dispatchId ?? null,
        event.phase,
        event.jobName,
        event.cron,
        event.scheduledTime,
        event.occurredAt,
        event.startedAt ?? null,
        event.finishedAt ?? null,
        event.durationMs ?? null,
        event.status,
        event.attempt ?? null,
        event.itemsProcessed ?? null,
        event.project ?? null,
        event.deployment ?? null,
        error?.name ?? null,
        error?.message ?? null,
        error?.code ?? null,
        now(),
      )
      .run();
    if (retentionMs > 0) await prune(now());
  };

  const has = async (id: string): Promise<boolean> => {
    requireSchema();
    const row = await options.db
      .prepare(`SELECT 1 AS present FROM ${table} WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<{ present?: number }>();
    return row?.present === 1;
  };

  const get = async (id: string): Promise<CronLedgerEvent | null> => {
    requireSchema();
    const row = await options.db.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`).bind(id).first();
    return row ? rowToEvent(row) : null;
  };

  const list = async (limit = 50): Promise<CronLedgerEvent[]> => {
    requireSchema();
    const bounded = Math.max(0, Math.min(1_000, Math.floor(limit)));
    const result = await options.db
      .prepare(`SELECT * FROM ${table} ORDER BY occurred_at DESC, id DESC LIMIT ?`)
      .bind(bounded)
      .all();
    return (result.results ?? []).map(rowToEvent).filter((event): event is CronLedgerEvent => event !== null);
  };

  const listByRun = async (runId: string, limit = 50): Promise<CronLedgerEvent[]> => {
    requireSchema();
    const bounded = Math.max(0, Math.min(1_000, Math.floor(limit)));
    const result = await options.db
      .prepare(`SELECT * FROM ${table} WHERE run_id = ? ORDER BY occurred_at ASC, id ASC LIMIT ?`)
      .bind(runId, bounded)
      .all();
    return (result.results ?? []).map(rowToEvent).filter((event): event is CronLedgerEvent => event !== null);
  };

  const prune = async (at = now()): Promise<number> => {
    if (retentionMs <= 0) return 0;
    requireSchema();
    const result = await options.db
      .prepare(`DELETE FROM ${table} WHERE occurred_at < ?`)
      .bind(at - retentionMs)
      .run();
    return Number(result.meta?.changes ?? 0);
  };

  return {
    ensureSchema,
    record: async (run) => recordEvent(cronRunToLedgerEvent(run)),
    recordEvent,
    has,
    get,
    list,
    listByRun,
    prune,
  };
}

/** Copy this into the consuming app's D1 migration. */
export const D1_CRON_RUNS_SCHEMA = `CREATE TABLE IF NOT EXISTS cron_runs (
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
CREATE INDEX IF NOT EXISTS cron_runs_occurred_at ON cron_runs (occurred_at DESC);`;
