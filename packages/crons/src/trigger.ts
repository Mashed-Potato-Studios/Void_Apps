import { isCronProductionEvidence, isVerifiedProductionEvidence } from "./evidence.js";
import type {
  CronActivityEntry,
  CronJob,
  CronTriggerOptions,
  CronTriggerResult,
} from "./types.js";

const DEV_TRIGGER_HEADER = "x-void-dev-trigger";
const INTERNAL_HEADER = "x-void-internal";

export function resolveTriggerTarget(opts: CronTriggerOptions): {
  url: string;
  local: boolean;
  headers: Record<string, string>;
  production: "local" | "verified" | "unverified";
} {
  for (const value of [opts.timeoutMs, opts.retryBaseMs]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error("timeouts and retry delays must be finite non-negative numbers");
  }
  if (opts.maxAttempts !== undefined && (!Number.isSafeInteger(opts.maxAttempts) || opts.maxAttempts < 1)) throw new Error("maxAttempts must be a positive safe integer");
  if (opts.scheduledTime !== undefined && !Number.isFinite(new Date(opts.scheduledTime).getTime())) throw new Error("scheduledTime must be a valid timestamp");
  const target = new URL(opts.origin);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
    throw new Error("origin must be an HTTP(S) origin without credentials, path, query, or fragment");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  const transport = opts.transport ?? "dev";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.bindingMode === "remote" && !opts.allowRemoteBindings) {
    throw new Error("remote bindings require explicit allowRemoteBindings consent");
  }
  if (transport === "dev") {
    if (!local) throw new Error("dev transport requires an exact loopback origin; remote dispatch requires explicit framework transport");
    if (opts.devToken) headers[DEV_TRIGGER_HEADER] = opts.devToken;
  } else if (transport === "framework") {
    if (local || target.protocol !== "https:") throw new Error("framework transport requires a non-loopback HTTPS origin");
    if (!opts.allowRemote) throw new Error("framework transport requires explicit allowRemote consent");
    if (!opts.cronSecret) throw new Error("framework transport requires an explicit internal token; endpoint support must be verified separately");
    if (opts.productionEvidence) {
      if (!isCronProductionEvidence(opts.productionEvidence)) throw new Error("invalid production evidence file");
      if (!isVerifiedProductionEvidence(opts.productionEvidence, target.origin)) {
        throw new Error("production evidence is not an accepted response for this origin; verify the deployed target first");
      }
    }
    headers[INTERNAL_HEADER] = opts.cronSecret;
  } else {
    throw new Error("unknown trigger transport");
  }
  return {
    url: new URL("/__void/scheduled", target).href,
    local,
    headers,
    production: transport === "dev" ? "local" : opts.productionEvidence ? "verified" : "unverified",
  };
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
    source: ["localhost", "127.0.0.1", "[::1]"].includes(new URL(opts.origin).hostname) ? "local" : "remote",
    kind: "dispatch",
    bindingMode: opts.bindingMode ?? "unknown",
    affectedJobs: opts.jobs?.filter((job) => job.expressions.includes(expression)).map((job) => job.name) ?? [jobName],
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
    const res = (await fetchImpl(url, { method: "POST", ...init, signal, redirect: "error" })) as unknown as {
      ok: boolean;
      status: number;
    };
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/** Dispatch an expression; this is not individual handler telemetry. */
export async function triggerExpression(
  expression: string,
  jobName: string,
  opts: CronTriggerOptions,
): Promise<CronTriggerResult> {
  const startedAt = Date.now();
  const scheduledTime = opts.scheduledTime ?? startedAt;
  let target: ReturnType<typeof resolveTriggerTarget>;
  try {
    target = resolveTriggerTarget(opts);
  } catch (error) {
    return { ok: false, skipped: true, reason: error instanceof Error ? error.message : "invalid trigger target", attempts: 0, retried: false };
  }
  const group = opts.jobs?.filter((job) => job.expressions.includes(expression)) ?? [];
  const disabled = new Set(opts.disabled ?? []);
  const blocked = group.find((job) => job.status !== "active" || disabled.has(job.name) || disabled.has(job.path));
  if (blocked) return { ok: false, skipped: true, reason: `expression ${expression} includes disabled or invalid job "${blocked.name}"; dispatch would run every matching handler`, attempts: 0, retried: false };
  const label = group.length > 1 ? `expression:${expression}` : jobName;
  const body = JSON.stringify({ cron: expression, scheduledTime });
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 1);
  const retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let attempt = 0;
  let lastError: string | undefined;
  for (;;) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        reason: "aborted",
        entry: attempt > 0 ? mkEntry(opts, label, expression, scheduledTime, startedAt, "unknown", "aborted; dispatch outcome unknown") : undefined,
        httpStatus: 0,
        attempts: attempt,
        retried: attempt > 1,
      };
    }
    attempt++;
    try {
      const res = await postOnce(target.url, { headers: target.headers, body }, opts);
      if (res.ok) {
        return {
          ok: true,
          entry: mkEntry(opts, label, expression, scheduledTime, startedAt, "success"),
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
          entry: mkEntry(opts, label, expression, scheduledTime, startedAt, "failed", lastError),
          httpStatus: res.status,
          attempts: attempt,
          retried: attempt > 1,
        };
      }
    } catch (e) {
      lastError = e instanceof Error && e.message === "aborted" ? "aborted; dispatch outcome unknown" : "transport failed; dispatch outcome unknown";
      if (attempt >= maxAttempts) {
        return {
          ok: false,
          entry: mkEntry(opts, label, expression, scheduledTime, startedAt, "unknown", lastError),
          httpStatus: 0,
          attempts: attempt,
          retried: attempt > 1,
        };
      }
    }
    if (opts.signal?.aborted) {
      return {
        ok: false,
        reason: "aborted",
        entry: mkEntry(opts, label, expression, scheduledTime, startedAt, "unknown", "aborted; dispatch outcome unknown"),
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
 * excluded from local inspection schedules; invalid jobs have nothing to fire.
 */
export async function triggerJob(
  job: CronJob,
  opts: CronTriggerOptions,
): Promise<CronTriggerResult[]> {
  if (job.status === "disabled" || opts.disabled?.includes(job.name) || opts.disabled?.includes(job.path)) {
    return [{ ok: false, skipped: true, reason: `job "${job.name}" is disabled`, attempts: 0, retried: false }];
  }
  if (job.status === "invalid" || job.expressions.length === 0) {
    return [{ ok: false, skipped: true, reason: job.error ?? `job "${job.name}" has no cron expression`, attempts: 0, retried: false }];
  }
  if (job.sharedExpression && !opts.jobs) {
    return [{ ok: false, skipped: true, reason: "shared expression requires the complete scanned job list to check disabled siblings", attempts: 0, retried: false }];
  }
  return Promise.all(
    job.expressions.map((expression) => triggerExpression(expression, job.name, opts)),
  );
}
