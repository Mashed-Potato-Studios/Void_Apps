import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CronActivityEntry } from "./types.js";

/** SQLite WAL database (default store). Lives next to the app; gitignored. */
export const CRON_ACTIVITY_DB_FILE = "void.crons.activity.sqlite";
/** Legacy line-delimited JSON log (`--store jsonl` only). */
export const CRON_ACTIVITY_FILE = "void.crons.activity.jsonl";
/** Pre-JSONL array file, read for backward compatibility when no newer store exists. */
export const CRON_ACTIVITY_LEGACY_FILE = "void.crons.activity.json";
const MAX_ENTRIES = 100;

export interface CronStore {
  record(input: Omit<CronActivityEntry, "id" | "finishedAt">): CronActivityEntry;
  list(limit?: number): CronActivityEntry[];
  clear(): void;
  setDisabled(jobName: string, disabled: boolean): void;
  isDisabled(jobName: string): boolean;
  getDisabled(): string[];
}

/** In-memory activity + toggle state. Swap for KV/Drizzle in prod; the panel only needs this shape. */
export function createCronStore(initial: { activity?: CronActivityEntry[]; disabled?: string[] } = {}): CronStore {
  const entries: CronActivityEntry[] = [...(initial.activity ?? [])];
  const disabled = new Set<string>(initial.disabled ?? []);
  return {
    record(input) {
      const entry: CronActivityEntry = {
        ...input,
        id: input.scheduledTime + "-" + Math.random().toString(36).slice(2, 10),
        finishedAt: new Date().toISOString(),
      };
      entries.unshift(entry);
      entries.splice(MAX_ENTRIES);
      return entry;
    },
    list(limit = 20) {
      return entries.slice(0, Math.max(0, limit));
    },
    clear() {
      entries.length = 0;
    },
    setDisabled(jobName, isDisabled) {
      if (isDisabled) disabled.add(jobName);
      else disabled.delete(jobName);
    },
    isDisabled(jobName) {
      return disabled.has(jobName);
    },
    getDisabled() {
      return [...disabled].sort();
    },
  };
}

export type ActivityStoreMode = "sqlite" | "jsonl";

function isActivityEntry(value: unknown): value is CronActivityEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["id"] === "string" && typeof v["jobName"] === "string" && typeof v["cron"] === "string";
}

/** Open (creating) the app's activity database. One connection per call; closed by caller. */
export function openActivityDb(appRoot: string): DatabaseSync {
  const db = new DatabaseSync(join(appRoot, CRON_ACTIVITY_DB_FILE));
  // busy_timeout FIRST: the journal_mode switch below needs an exclusive lock and
  // concurrent CLI/panel writers collide here; a locked switch means WAL is already on.
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    db.exec("PRAGMA journal_mode = WAL");
  } catch {
    // Another writer holds the lock mid-switch; WAL persists once set — proceed.
  }
  db.exec(
    `CREATE TABLE IF NOT EXISTS cron_activity (
      id TEXT PRIMARY KEY,
      job_name TEXT NOT NULL,
      cron TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      items_processed INTEGER,
      error TEXT,
      source TEXT NOT NULL,
      recorded_at INTEGER NOT NULL
    )`,
  );
  db.exec("CREATE INDEX IF NOT EXISTS cron_activity_recorded_at ON cron_activity (recorded_at DESC, id DESC)");
  return db;
}

function rowToEntry(row: Record<string, unknown>): CronActivityEntry | null {
  if (typeof row["id"] !== "string" || typeof row["job_name"] !== "string" || typeof row["cron"] !== "string") {
    return null;
  }
  const entry: CronActivityEntry = {
    id: row["id"],
    jobName: row["job_name"],
    cron: row["cron"],
    scheduledTime: String(row["scheduled_time"] ?? ""),
    finishedAt: String(row["finished_at"] ?? ""),
    durationMs: typeof row["duration_ms"] === "number" ? row["duration_ms"] : 0,
    status:
      row["status"] === "success" || row["status"] === "failed" || row["status"] === "skipped"
        ? row["status"]
        : "failed",
    source: row["source"] === "remote" ? "remote" : "local",
  };
  if (typeof row["items_processed"] === "number") entry.itemsProcessed = row["items_processed"];
  if (typeof row["error"] === "string") entry.error = row["error"];
  return entry;
}

export function appendActivityDb(appRoot: string, entries: CronActivityEntry[]): void {
  if (entries.length === 0) return;
  const db = openActivityDb(appRoot);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO cron_activity
        (id, job_name, cron, scheduled_time, finished_at, duration_ms, status, items_processed, error, source, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of entries) {
      stmt.run(
        e.id,
        e.jobName,
        e.cron,
        e.scheduledTime,
        e.finishedAt,
        e.durationMs,
        e.status,
        e.itemsProcessed ?? null,
        e.error ?? null,
        e.source,
        Date.now(),
      );
    }
    db.exec(
      `DELETE FROM cron_activity WHERE id NOT IN (
        SELECT id FROM cron_activity ORDER BY recorded_at DESC, id DESC LIMIT ${MAX_ENTRIES}
      )`,
    );
  } finally {
    db.close();
  }
}

export function readActivityDb(appRoot: string, limit = 20): CronActivityEntry[] {
  if (!existsSync(join(appRoot, CRON_ACTIVITY_DB_FILE))) return [];
  const db = openActivityDb(appRoot);
  try {
    const rows = db
      .prepare(
        `SELECT * FROM cron_activity ORDER BY recorded_at DESC, id DESC LIMIT ${Math.max(0, Math.floor(limit))}`,
      )
      .all() as Record<string, unknown>[];
    const out: CronActivityEntry[] = [];
    for (const row of rows) {
      const entry = rowToEntry(row);
      if (entry) out.push(entry);
    }
    return out;
  } finally {
    db.close();
  }
}

function parseActivityLines(raw: string): CronActivityEntry[] {
  const out: CronActivityEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isActivityEntry(parsed)) out.push(parsed);
    } catch {
      continue;
    }
  }
  return out;
}

/** Legacy JSONL append (`--store jsonl` only). SQLite is the default. */
export function appendActivityJsonl(appRoot: string, entries: CronActivityEntry[]): CronActivityEntry[] {
  if (entries.length === 0) return readActivityJsonl(appRoot, MAX_ENTRIES);
  appendFileSync(join(appRoot, CRON_ACTIVITY_FILE), entries.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return readActivityJsonl(appRoot, MAX_ENTRIES);
}

export function readActivityJsonl(appRoot: string, limit = 20): CronActivityEntry[] {
  const parsed: CronActivityEntry[] = [];
  let haveJsonl = false;
  try {
    const raw = readFileSync(join(appRoot, CRON_ACTIVITY_FILE), "utf8");
    haveJsonl = true;
    parsed.push(...parseActivityLines(raw));
  } catch {
    haveJsonl = false;
  }
  // Pre-JSONL array file: read only when no JSONL exists yet (first append migrates forward).
  if (!haveJsonl) {
    try {
      const legacy = JSON.parse(readFileSync(join(appRoot, CRON_ACTIVITY_LEGACY_FILE), "utf8")) as unknown;
      if (Array.isArray(legacy)) {
        for (const item of legacy) if (isActivityEntry(item)) parsed.push(item);
      }
    } catch {
      return [];
    }
  }
  return parsed.slice(-Math.max(0, limit)).reverse();
}

/**
 * Default activity persistence: SQLite WAL (atomic multi-writer, newest-100 trim).
 * Pass `jsonl` for the legacy file log.
 */
export function appendActivityLog(
  appRoot: string,
  entries: CronActivityEntry[],
  mode: ActivityStoreMode = "sqlite",
): CronActivityEntry[] {
  if (mode === "jsonl") return appendActivityJsonl(appRoot, entries);
  appendActivityDb(appRoot, entries);
  return readActivityDb(appRoot, MAX_ENTRIES);
}

export function readActivityLog(
  appRoot: string,
  limit = 20,
  mode: ActivityStoreMode = "sqlite",
): CronActivityEntry[] {
  if (mode === "jsonl") return readActivityJsonl(appRoot, limit);
  const fromDb = readActivityDb(appRoot, limit);
  if (fromDb.length > 0) return fromDb;
  // Migrate forward: legacy file/JSONL history shows until the first sqlite append.
  return readActivityJsonl(appRoot, limit);
}

/** Compact the JSONL to the newest 100 entries; safe to call rarely (deploy, cron prune). */
export function pruneActivityLog(appRoot: string): void {
  const path = join(appRoot, CRON_ACTIVITY_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length <= MAX_ENTRIES) return;
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${lines.slice(-MAX_ENTRIES).join("\n")}\n`);
  renameSync(tmp, path);
}
