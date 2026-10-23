export interface CronScheduledController {
  scheduledTime: number;
  cron: string;
}

export type CronRunStatus = "success" | "failed" | "skipped";

export type CronLedgerPhase =
  | "dispatch"
  | "enqueue"
  | "consume-start"
  | "handler"
  | "completion"
  | "retry"
  | "exhausted"
  | "notification";

export type CronLedgerStatus = CronRunStatus | "pending" | "unknown";

export interface CronErrorSummary {
  name: string;
  message: string;
  code?: string;
}

export interface CronRunRecord {
  id: string;
  jobName: string;
  cron: string;
  scheduledTime: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: CronRunStatus;
  runId?: string;
  dispatchId?: string;
  phase?: CronLedgerPhase;
  attempt?: number;
  itemsProcessed?: number;
  project?: string;
  deployment?: string;
  error?: CronErrorSummary;
}

/** A single correlated ledger event. `id` is the application-owned idempotency key. */
export interface CronLedgerEvent {
  id: string;
  runId: string;
  dispatchId?: string;
  phase: CronLedgerPhase;
  jobName: string;
  cron: string;
  scheduledTime: number;
  occurredAt: number;
  status: CronLedgerStatus;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  attempt?: number;
  itemsProcessed?: number;
  project?: string;
  deployment?: string;
  error?: CronErrorSummary;
}

export interface CronRunStore {
  record(run: CronRunRecord): Promise<void>;
}

export interface CronLedgerStore {
  recordEvent(event: CronLedgerEvent): Promise<void>;
  has(id: string): Promise<boolean>;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(token|secret|password|authorization|api[-_]?key)\b\s*[:=]\s*["']?[^\s,;}]+/gi,
  /\bx-void-[a-z-]+\s*:\s*[^\s,;}]+/gi,
];

export function redactCronText(value: string, maxLength = 300): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, "[redacted]");
  return redacted.slice(0, Math.max(1, maxLength));
}

/**
 * Store only a bounded, redacted error summary. Never persist a raw error
 * object, request headers, or a full stack trace.
 */
export function summarizeCronError(error: unknown, maxLength = 300): CronErrorSummary {
  const name = typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : "Error";
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "non-error failure";
  const message = redactCronText(raw, maxLength);
  const summary: CronErrorSummary = { name: redactCronText(name, 64), message };
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    summary.code = redactCronText(error.code, 64);
  }
  return summary;
}

export function sanitizeCronErrorSummary(error: CronErrorSummary | undefined): CronErrorSummary | undefined {
  if (!error) return undefined;
  return {
    name: redactCronText(error.name, 64),
    message: redactCronText(error.message, 300),
    ...(error.code ? { code: redactCronText(error.code, 64) } : {}),
  };
}

export function cronRunToLedgerEvent(run: CronRunRecord): CronLedgerEvent {
  const event: CronLedgerEvent = {
    id: run.id,
    runId: run.runId ?? run.id,
    phase: run.phase ?? "handler",
    jobName: run.jobName,
    cron: run.cron,
    scheduledTime: run.scheduledTime,
    occurredAt: run.finishedAt,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
  };
  if (run.dispatchId) event.dispatchId = run.dispatchId;
  if (run.attempt !== undefined) event.attempt = run.attempt;
  if (run.itemsProcessed !== undefined) event.itemsProcessed = run.itemsProcessed;
  if (run.project) event.project = run.project;
  if (run.deployment) event.deployment = run.deployment;
  if (run.error) event.error = run.error;
  return event;
}

export type CronTelemetryStage = "clock" | "pause" | "record" | "store" | "notify";

export interface CronInstrumentationOptions<
  Arguments extends [CronScheduledController, unknown, unknown],
> {
  store: CronRunStore;
  isPaused?: (...args: Arguments) => boolean | Promise<boolean>;
  notify?: (run: CronRunRecord, ...args: Arguments) => void | Promise<void>;
  onTelemetryError?: (error: unknown, stage: CronTelemetryStage) => void | Promise<void>;
  now?: () => number;
  createId?: () => string;
  /** Stable application-owned idempotency key; defaults to a fresh random ID. */
  idempotencyKey?: string | ((...args: Arguments) => string);
}

export function instrumentScheduled<
  Arguments extends [CronScheduledController, unknown, unknown],
  Result,
>(
  jobName: string,
  handler: (...args: Arguments) => Result,
  options: CronInstrumentationOptions<Arguments> & { isPaused?: never },
): (...args: Arguments) => Promise<Awaited<Result>>;
export function instrumentScheduled<
  Arguments extends [CronScheduledController, unknown, unknown],
  Result,
>(
  jobName: string,
  handler: (...args: Arguments) => Result,
  options: CronInstrumentationOptions<Arguments>,
): (...args: Arguments) => Promise<Awaited<Result> | undefined>;
export function instrumentScheduled<
  Arguments extends [CronScheduledController, unknown, unknown],
  Result,
>(
  jobName: string,
  handler: (...args: Arguments) => Result,
  options: CronInstrumentationOptions<Arguments>,
): (...args: Arguments) => Promise<Awaited<Result> | undefined> {
  const observe = async (error: unknown, stage: CronTelemetryStage): Promise<void> => {
    try {
      await options.onTelemetryError?.(error, stage);
    } catch {}
  };

  const time = async (): Promise<number> => {
    try {
      return (options.now ?? Date.now)();
    } catch (error) {
      await observe(error, "clock");
      return Date.now();
    }
  };

  return async (...args: Arguments): Promise<Awaited<Result> | undefined> => {
    const startedAt = await time();
    const { cron, scheduledTime } = args[0];
    let paused = false;
    try {
      paused = await options.isPaused?.(...args) ?? false;
    } catch (error) {
      paused = true;
      await observe(error, "pause");
    }

    let result: Awaited<Result> | undefined;
    let failure: unknown;
    let status: CronRunRecord["status"] = "skipped";
    if (!paused) {
      try {
        result = await handler(...args);
        status = "success";
      } catch (error) {
        failure = error;
        status = "failed";
      }
    }

    const finishedAt = await time();
    let run: CronRunRecord | undefined;
    try {
      const id = typeof options.idempotencyKey === "function"
        ? options.idempotencyKey(...args)
        : options.idempotencyKey;
      run = {
        id: id ?? (options.createId ?? (() => crypto.randomUUID()))(),
        jobName,
        cron,
        scheduledTime,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        status,
      };
      if (status === "failed") run.error = summarizeCronError(failure);
    } catch (error) {
      await observe(error, "record");
    }
    if (run) {
      let persisted = false;
      try {
        await options.store.record(run);
        persisted = true;
      } catch (error) {
        await observe(error, "store");
      }
      try {
        if (persisted) await options.notify?.(run, ...args);
      } catch (error) {
        await observe(error, "notify");
      }
    }

    if (status === "failed") throw failure;
    return result;
  };
}
