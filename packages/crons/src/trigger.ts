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

/** Fire one cron expression against a Void dev server (or prod webhook with a secret). */
export async function triggerExpression(
  expression: string,
  jobName: string,
  opts: CronTriggerOptions,
): Promise<CronTriggerResult> {
  const startedAt = Date.now();
  const scheduledTime = opts.scheduledTime ?? startedAt;
  const fetchImpl = opts.fetchImpl ?? fetch;
  // Dev calls authenticate with `x-void-dev-trigger`. The prod secret is only
  // attached for non-local origins so it can never leak to a dev server.
  const local = isLocalOrigin(opts.origin);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.devToken) headers[DEV_TRIGGER_HEADER] = opts.devToken;
  const secret = opts.cronSecret ?? (local ? undefined : process.env["CRON_SECRET"]);
  if (!local && secret) headers[INTERNAL_HEADER] = secret;
  try {
    const res = await fetchImpl(`${opts.origin}/__void/scheduled`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cron: expression, scheduledTime }),
    });
    const entry = res.ok
      ? mkEntry(opts, jobName, expression, scheduledTime, startedAt, "success")
      : mkEntry(opts, jobName, expression, scheduledTime, startedAt, "failed", `HTTP ${res.status}`);
    return { ok: res.ok, entry, httpStatus: res.status };
  } catch (e) {
    const entry = mkEntry(
      opts,
      jobName,
      expression,
      scheduledTime,
      startedAt,
      "failed",
      e instanceof Error ? e.message : String(e),
    );
    return { ok: false, entry, httpStatus: 0 };
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
    return [{ ok: false, skipped: true, reason: `job "${job.name}" is disabled` }];
  }
  if (job.status === "invalid" || job.expressions.length === 0) {
    return [{ ok: false, skipped: true, reason: job.error ?? `job "${job.name}" has no cron expression` }];
  }
  return Promise.all(
    job.expressions.map((expression) => triggerExpression(expression, job.name, opts)),
  );
}
