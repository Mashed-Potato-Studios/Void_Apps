import type {
  CronActivityEntry,
  CronJob,
  CronTriggerOptions,
  CronTriggerResult,
} from "./types.js";

const DEV_TRIGGER_HEADER = "x-void-dev-trigger";
const INTERNAL_HEADER = "x-void-internal";

function isLocalOrigin(origin: string): boolean {
  return origin.includes("localhost") || origin.includes("127.0.0.1");
}

function mkEntry(
  opts: CronTriggerOptions,
  jobName: string,
  expression: string,
  scheduledTime: number,
  startedAt: number,
  status: CronActivityEntry["status"],
  error?: string,
): CronActivityEntry {
  const entry: CronActivityEntry = {
    id: `${scheduledTime}-${Math.random().toString(36).slice(2, 10)}`,
    jobName,
    cron: expression,
    scheduledTime: new Date(scheduledTime).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    status,
    source: isLocalOrigin(opts.origin) ? "local" : "remote",
  };
  if (error !== undefined) entry.error = error;
  return entry;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_BASE_MS = 500;

function isRetryableHttp(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function postOnce(
  url: string,
  init: { headers: Record<string, string>; body: string },
  opts: CronTriggerOptions,
): Promise<{ ok: boolean; status: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
  try {
    const res = (await fetchImpl(url, { method: "POST", ...init, signal })) as unknown as {
      ok: boolean;
      status: number;
    };
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/** Fire one cron expression against a Void dev server (or prod webhook with a secret). */
export async function triggerExpression(
  expression: string,
  jobName: string,
  opts: CronTriggerOptions,
): Promise<CronTriggerResult> {
  const startedAt = Date.now();
  const scheduledTime = opts.scheduledTime ?? startedAt;
  // Dev calls authenticate with `x-void-dev-trigger`. The prod secret is only
  // attached for non-local origins so it can never leak to a dev server.
  const local = isLocalOrigin(opts.origin);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.devToken) headers[DEV_TRIGGER_HEADER] = opts.devToken;
  const secret = opts.cronSecret ?? (local ? undefined : process.env["CRON_SECRET"]);
  if (!local && secret) headers[INTERNAL_HEADER] = secret;
  const body = JSON.stringify({ cron: expression, scheduledTime });
  const url = `${opts.origin}/__void/scheduled`;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 1);
  const retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let attempt = 0;
  let lastError: string | undefined;
  for (;;) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        entry: mkEntry(opts, jobName, expression, scheduledTime, startedAt, "failed", "aborted"),
        httpStatus: 0,
        attempts: Math.max(1, attempt),
        retried: false,
      };
    }
    attempt++;
    try {
      const res = await postOnce(url, { headers, body }, opts);
      if (res.ok) {
        return {
          ok: true,
          entry: mkEntry(opts, jobName, expression, scheduledTime, startedAt, "success"),
          httpStatus: res.status,
          attempts: attempt,
          retried: attempt > 1,
        };
      }
      lastError = `HTTP ${res.status}`;
      // Only retry rate-limit/transient statuses; a 4xx like 401 is final.
      if (!isRetryableHttp(res.status) || attempt >= maxAttempts) {
        return {
          ok: false,
          entry: mkEntry(opts, jobName, expression, scheduledTime, startedAt, "failed", lastError),
          httpStatus: res.status,
          attempts: attempt,
          retried: attempt > 1,
        };
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt >= maxAttempts) {
        return {
          ok: false,
          entry: mkEntry(opts, jobName, expression, scheduledTime, startedAt, "failed", lastError),
          httpStatus: 0,
          attempts: attempt,
          retried: attempt > 1,
        };
      }
    }
    if (opts.signal?.aborted) {
      return {
        ok: false,
        entry: mkEntry(opts, jobName, expression, scheduledTime, startedAt, "failed", "aborted"),
        httpStatus: 0,
        attempts: attempt,
        retried: attempt > 1,
      };
    }
    await sleep(retryBaseMs * 2 ** (attempt - 1));
  }
}

/**
 * Fire every expression a job exports. Disabled jobs are skipped locally and
 * hidden from the deploy manifest; invalid jobs have nothing to fire.
 */
export async function triggerJob(
  job: CronJob,
  opts: CronTriggerOptions,
): Promise<CronTriggerResult[]> {
  if (job.status === "disabled") {
    return [{ ok: false, skipped: true, reason: `job "${job.name}" is disabled`, attempts: 0, retried: false }];
  }
  if (job.status === "invalid" || job.expressions.length === 0) {
    return [{ ok: false, skipped: true, reason: job.error ?? `job "${job.name}" has no cron expression`, attempts: 0, retried: false }];
  }
  return Promise.all(
    job.expressions.map((expression) => triggerExpression(expression, job.name, opts)),
  );
}
