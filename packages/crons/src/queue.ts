import {
  summarizeCronError,
  type CronErrorSummary,
  type CronLedgerEvent,
  type CronLedgerStore,
} from "./runtime.js";

export interface CronQueueMessage<Body = unknown> {
  runId: string;
  dispatchId: string;
  jobName: string;
  cron: string;
  scheduledTime: number;
  attempt: number;
  idempotencyKey: string;
  body: Body;
  project?: string;
  deployment?: string;
}

export interface CronQueueSender<Body = unknown> {
  send(message: CronQueueMessage<Body>): Promise<void>;
}

export interface CronQueuePublishInput<Body = unknown> {
  runId: string;
  dispatchId?: string;
  jobName: string;
  cron: string;
  scheduledTime: number;
  body: Body;
  attempt?: number;
  idempotencyKey?: string;
  project?: string;
  deployment?: string;
}

export interface CronQueuePublishResult<Body = unknown> {
  sent: boolean;
  recorded: boolean;
  duplicate: boolean;
  message: CronQueueMessage<Body>;
  event?: CronLedgerEvent;
  error?: CronErrorSummary;
}

export interface CronQueueConsumeOptions {
  /** Total handler attempts including the first. Default 3. */
  maxAttempts?: number;
}

export interface CronQueueConsumeResult<Result = unknown> {
  status: "success" | "failed" | "exhausted" | "duplicate";
  result?: Result;
  shouldRetry: boolean;
  recorded: boolean;
  event?: CronLedgerEvent;
  error?: CronErrorSummary;
}

export interface CronQueueCorrelationOptions<Body = unknown> {
  sender: CronQueueSender<Body>;
  store: CronLedgerStore;
  now?: () => number;
  project?: string;
  deployment?: string;
}

export interface CronQueueCorrelation<Body = unknown> {
  publish(input: CronQueuePublishInput<Body>): Promise<CronQueuePublishResult<Body>>;
  consume<Result>(
    message: CronQueueMessage<Body>,
    handler: (body: Body, message: CronQueueMessage<Body>) => Result | Promise<Result>,
    options?: CronQueueConsumeOptions,
  ): Promise<CronQueueConsumeResult<Awaited<Result>>>;
}

function defaultKey(input: CronQueuePublishInput): string {
  return `${input.runId}:${input.jobName}:${input.scheduledTime}`;
}

function eventBase(
  message: CronQueueMessage,
  now: number,
  options: CronQueueCorrelationOptions,
): Omit<CronLedgerEvent, "id" | "phase" | "status"> {
  return {
    runId: message.runId,
    dispatchId: message.dispatchId,
    jobName: message.jobName,
    cron: message.cron,
    scheduledTime: message.scheduledTime,
    occurredAt: now,
    attempt: message.attempt,
    ...(message.project !== undefined
      ? { project: message.project }
      : options.project !== undefined
        ? { project: options.project }
        : {}),
    ...(message.deployment !== undefined
      ? { deployment: message.deployment }
      : options.deployment !== undefined
        ? { deployment: options.deployment }
        : {}),
  };
}

async function tryRecord(store: CronLedgerStore, event: CronLedgerEvent): Promise<boolean> {
  try {
    await store.recordEvent(event);
    return true;
  } catch {
    return false;
  }
}

/**
 * Correlate cron dispatch, queue enqueue, consumer completion, retry, and
 * exhaustion. The consuming app owns the queue binding and must use the
 * returned retry signal to drive queue ack/retry.
 */
export function createCronQueueCorrelation<Body = unknown>(
  options: CronQueueCorrelationOptions<Body>,
): CronQueueCorrelation<Body> {
  const now = options.now ?? Date.now;

  const publish = async (input: CronQueuePublishInput<Body>): Promise<CronQueuePublishResult<Body>> => {
    const attempt = input.attempt ?? 1;
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive safe integer");
    const key = input.idempotencyKey ?? defaultKey(input);
    const message: CronQueueMessage<Body> = {
      runId: input.runId,
      dispatchId: input.dispatchId ?? `${input.runId}:dispatch`,
      jobName: input.jobName,
      cron: input.cron,
      scheduledTime: input.scheduledTime,
      attempt,
      idempotencyKey: key,
      body: input.body,
      ...(input.project ?? options.project ? { project: input.project ?? options.project } : {}),
      ...(input.deployment ?? options.deployment ? { deployment: input.deployment ?? options.deployment } : {}),
    };
    const enqueueId = `${key}:enqueue`;
    try {
      if (await options.store.has(enqueueId)) {
        return { sent: false, recorded: true, duplicate: true, message };
      }
    } catch (error) {
      return { sent: false, recorded: false, duplicate: false, message, error: summarizeCronError(error) };
    }

    try {
      await options.sender.send(message);
    } catch (error) {
      const summary = summarizeCronError(error);
      const event: CronLedgerEvent = {
        ...eventBase(message, now(), options),
        id: `${key}:enqueue-failure:${attempt}`,
        phase: "enqueue",
        status: "failed",
        error: summary,
      };
      return {
        sent: false,
        recorded: await tryRecord(options.store, event),
        duplicate: false,
        message,
        event,
        error: summary,
      };
    }

    const event: CronLedgerEvent = {
      ...eventBase(message, now(), options),
      id: enqueueId,
      phase: "enqueue",
      status: "success",
    };
    return {
      sent: true,
      recorded: await tryRecord(options.store, event),
      duplicate: false,
      message,
      event,
    };
  };

  const consume = async <Result>(
    message: CronQueueMessage<Body>,
    handler: (body: Body, message: CronQueueMessage<Body>) => Result | Promise<Result>,
    consumeOptions: CronQueueConsumeOptions = {},
  ): Promise<CronQueueConsumeResult<Awaited<Result>>> => {
    const maxAttempts = consumeOptions.maxAttempts ?? 3;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive safe integer");
    const key = message.idempotencyKey;
    const doneId = `${key}:done`;
    try {
      if (await options.store.has(doneId)) {
        return { status: "duplicate", shouldRetry: false, recorded: true };
      }
    } catch (error) {
      return {
        status: "failed",
        shouldRetry: true,
        recorded: false,
        error: summarizeCronError(error),
      };
    }

    const start: CronLedgerEvent = {
      ...eventBase(message, now(), options),
      id: `${key}:start:${message.attempt}`,
      phase: "consume-start",
      status: "pending",
    };
    try {
      await options.store.recordEvent(start);
    } catch (error) {
      return {
        status: "failed",
        shouldRetry: true,
        recorded: false,
        error: summarizeCronError(error),
      };
    }

    try {
      const result = await handler(message.body, message);
      const done: CronLedgerEvent = {
        ...eventBase(message, now(), options),
        id: doneId,
        phase: "completion",
        status: "success",
      };
      const recorded = await tryRecord(options.store, done);
      return { status: "success", result: result as Awaited<Result>, shouldRetry: false, recorded, event: done };
    } catch (error) {
      const summary = summarizeCronError(error);
      const exhausted = message.attempt >= maxAttempts;
      const event: CronLedgerEvent = {
        ...eventBase(message, now(), options),
        id: exhausted ? `${key}:exhausted` : `${key}:retry:${message.attempt}`,
        phase: exhausted ? "exhausted" : "retry",
        status: "failed",
        error: summary,
      };
      const recorded = await tryRecord(options.store, event);
      if (exhausted && !recorded) {
        return { status: "failed", shouldRetry: true, recorded: false, event, error: summary };
      }
      return {
        status: exhausted ? "exhausted" : "failed",
        shouldRetry: !exhausted,
        recorded,
        event,
        error: summary,
      };
    }
  };

  return { publish, consume };
}
