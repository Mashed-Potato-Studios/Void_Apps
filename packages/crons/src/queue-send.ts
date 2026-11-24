import { createPlatform, linkAbortSignal, type CronPlatform } from "./platform.js";
import { validateQueueName } from "./queue-name.js";

/**
 * Manual dispatch to Void's local queue dev endpoint (`POST /__void/queue`).
 * This is a development aid: it does not enqueue through the platform's queue
 * binding and is not evidence of production delivery.
 *
 * Source: https://void.cloud/guide/queues#local-development
 */

const DEV_TRIGGER_HEADER = "x-void-dev-trigger";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_BASE_MS = 500;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface QueueSendOptions {
  origin: string;
  /** `$VOID_DEV_TRIGGER` equivalent; sent as `x-void-dev-trigger`. */
  devToken?: string;
  timeoutMs?: number;
  /** Total attempts including the first. Default 1. */
  maxAttempts?: number;
  retryBaseMs?: number;
  /** Host capabilities to use; defaults resolve from host globals. */
  platform?: CronPlatform;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export interface QueueSendMessage {
  id?: string;
  timestamp?: number;
  body: unknown;
  attempts?: number;
}

export interface QueueSendResult {
  ok: boolean;
  httpStatus: number;
  attempts: number;
  retried: boolean;
  durationMs: number;
  count: number;
  reason?: string;
}

export interface QueueResolvedTarget {
  url: string;
  headers: Record<string, string>;
}

export function resolveQueueTarget(queue: string, opts: QueueSendOptions): QueueResolvedTarget {
  const nameProblem = validateQueueName(queue);
  if (nameProblem !== null) throw new Error(nameProblem);
  for (const value of [opts.timeoutMs, opts.retryBaseMs]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error("timeouts and retry delays must be finite non-negative numbers");
    }
  }
  if (opts.maxAttempts !== undefined && (!Number.isSafeInteger(opts.maxAttempts) || opts.maxAttempts < 1)) {
    throw new Error("maxAttempts must be a positive safe integer");
  }
  const target = new URL(opts.origin);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password ||
    target.search || target.hash || target.pathname !== "/") {
    throw new Error("origin must be an HTTP(S) origin without credentials, path, query, or fragment");
  }
  if (!LOOPBACK.has(target.hostname)) {
    throw new Error("queue dev dispatch requires an exact loopback origin; remote queue delivery is the platform's job");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.devToken) headers[DEV_TRIGGER_HEADER] = opts.devToken;
  return { url: new URL("/__void/queue", target).href, headers };
}

function isRetryableHttp(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function buildQueueBatch(
  queue: string,
  messages: QueueSendMessage[],
  nowMs: number,
  newId?: () => string,
): {
  queue: string;
  messages: Array<{ id: string; timestamp: number; body: unknown; attempts: number }>;
} {
  if (messages.length === 0) throw new Error("at least one message is required");
  const makeId = newId ?? createPlatform().newId;
  return {
    queue,
    messages: messages.map((message, index) => {
      const attempts = message.attempts ?? 1;
      if (!Number.isSafeInteger(attempts) || attempts < 1) throw new Error("message attempts must be a positive safe integer");
      const timestamp = message.timestamp ?? nowMs;
      if (!Number.isFinite(timestamp)) throw new Error("message timestamp must be a finite number");
      return {
        id: message.id ?? `${queue}-${nowMs}-${index}-${makeId()}`,
        timestamp,
        body: message.body,
        attempts,
      };
    }),
  };
}

/** POST one batch to the local dev endpoint; HTTP acknowledgement is not handler success. */
export async function sendQueueBatch(
  queue: string,
  messages: QueueSendMessage[],
  opts: QueueSendOptions,
): Promise<QueueSendResult> {
  const platform = opts.platform ?? createPlatform();
  const startedAt = platform.now();
  const result = (ok: boolean, httpStatus: number, attempts: number, reason?: string): QueueSendResult => ({
    ok,
    httpStatus,
    attempts,
    retried: attempts > 1,
    durationMs: platform.now() - startedAt,
    count: messages.length,
    ...(reason !== undefined ? { reason } : {}),
  });

  let target: QueueResolvedTarget;
  let batch: ReturnType<typeof buildQueueBatch>;
  try {
    target = resolveQueueTarget(queue, opts);
    batch = buildQueueBatch(queue, messages, startedAt, platform.newId);
  } catch (error) {
    return result(false, 0, 0, error instanceof Error ? error.message : "invalid queue dispatch");
  }

  const maxAttempts = opts.maxAttempts ?? 1;
  const retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = (opts.fetchImpl ?? platform.fetch) as CronPlatform["fetch"];
  const sleep = opts.sleepImpl ?? platform.sleep;
  let attempt = 0;
  for (;;) {
    if (opts.signal?.aborted) return result(false, 0, attempt, "aborted");
    attempt++;
    const { controller, cleanup } = linkAbortSignal(platform, opts.signal);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(target.url, {
        method: "POST",
        headers: target.headers,
        body: JSON.stringify(batch),
        signal: controller.signal,
        redirect: "error",
      });
      if (response.ok) return result(true, response.status, attempt);
      if (!isRetryableHttp(response.status) || attempt >= maxAttempts) {
        return result(false, response.status, attempt, `HTTP ${response.status}`);
      }
    } catch (error) {
      const aborted = error instanceof Error && error.message === "aborted";
      const cause = typeof error === "object" && error !== null && "cause" in error
        ? (error as { cause?: unknown }).cause
        : undefined;
      // Classify only — never echo raw fetch text, which can contain credentials.
      const raw = `${error instanceof Error ? error.message : String(error)} ${cause instanceof Error ? cause.message : ""}`;
      const unreachable = /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET|fetch failed/i.test(raw);
      const reason = aborted
        ? "aborted; dispatch outcome unknown"
        : unreachable
          ? "transport failed; dispatch outcome unknown (connection refused or unreachable)"
          : "transport failed; dispatch outcome unknown";
      if (attempt >= maxAttempts) return result(false, 0, attempt, reason);
    } finally {
      clearTimeout(timer);
      cleanup();
    }
    if (opts.signal?.aborted) return result(false, 0, attempt, "aborted");
    await sleep(retryBaseMs * 2 ** (attempt - 1));
  }
}
