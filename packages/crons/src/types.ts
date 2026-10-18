/**
 * void-crons — shared types for the cron inspector.
 *
 * Mirrors Void's `crons/` contract: each job file must export
 * `export const cron = "<expression>"` (or an array of expressions)
 * plus a default handler. Files/dirs starting with `_` are ignored.
 */

export type CronJobStatus = "active" | "disabled" | "invalid";

export interface CronJob {
  /** File path relative to the app root, e.g. `crons/cleanup.ts`. */
  path: string;
  /** Short name derived from the file name, e.g. `cleanup`. */
  name: string;
  /** Cron expressions exported by the file. Empty when `invalid`. */
  expressions: string[];
  /** Toggle state. `disabled` = skipped by local trigger + hidden from deploy manifest. */
  status: CronJobStatus;
  /** Set when `status === "invalid"`: missing/unsupported `cron` export. */
  error?: string;
  /** `true` when the file uses `defineScheduled` (recommended wrapper). */
  usesDefineScheduled: boolean;
  /** 1 when this job shares its expression with another job file. */
  sharedExpression: boolean;
}

export interface CronManifest {
  format: 1;
  /** App dir name (basename of the app root). */
  app: string;
  emittedAt: string;
  jobs: CronJob[];
  /** Distinct expression count (Void platform limit: 100). */
  expressionCount: number;
  /** Total schedule count (Void platform limit: 1000). */
  scheduleCount: number;
  disabled: string[];
  invalid: { path: string; error: string }[];
}

export interface CronActivityEntry {
  id: string;
  jobName: string;
  /** Cron expression that fired. */
  cron: string;
  scheduledTime: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "failed" | "skipped";
  itemsProcessed?: number;
  error?: string;
  /** `local` (dev trigger) or `remote` (prod webhook record). */
  source: "local" | "remote";
}

export interface CronTriggerOptions {
  /** Dev server origin, e.g. `http://localhost:5173`. */
  origin: string;
  /** Value printed by the dev server for `x-void-dev-trigger`. */
  devToken?: string;
  /** When set (or `CRON_SECRET` env), sent as `x-void-internal` for prod calls. */
  cronSecret?: string;
  scheduledTime?: number;
  fetchImpl?: typeof fetch;
  /** Per-attempt timeout in ms (default 10_000). */
  timeoutMs?: number;
  /** Total attempts including the first (default 1; `trigger` CLI passes `--retries + 1`). */
  maxAttempts?: number;
  /** Base backoff between attempts in ms (default 500, doubled each retry). */
  retryBaseMs?: number;
  /** Override the sleep between retries (tests). */
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface CronTriggerResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  entry?: CronActivityEntry;
  httpStatus?: number;
  /** 1-based count of HTTP attempts made. */
  attempts: number;
  /** True when the final outcome followed at least one retry. */
  retried: boolean;
}
