import {
  cronRunToLedgerEvent,
  sanitizeCronErrorSummary,
  summarizeCronError,
  type CronErrorSummary,
  type CronLedgerEvent,
  type CronRunRecord,
} from "./runtime.js";

export interface CronLiveStream {
  publish(
    topic: string,
    data: unknown,
    options?: { type?: string; eventId?: string },
  ): Promise<void>;
}

export interface CronLiveNotification {
  id: string;
  runId: string;
  dispatchId?: string;
  phase: string;
  jobName: string;
  cron: string;
  scheduledTime: number;
  occurredAt: number;
  status: string;
  attempt?: number;
  durationMs?: number;
  project?: string;
  deployment?: string;
  error?: CronErrorSummary;
}

export interface CronLiveNotifierOptions {
  stream: CronLiveStream;
  topic: string | ((event: CronLedgerEvent) => string);
  type?: string;
  createId?: (event: CronLedgerEvent) => string;
  onError?: (error: unknown, event: CronLedgerEvent) => void | Promise<void>;
}

export interface CronLivePublishResult {
  published: boolean;
  event?: CronLiveNotification;
  error?: CronErrorSummary;
}

export interface CronLiveNotifier {
  publish(event: CronLedgerEvent): Promise<CronLivePublishResult>;
  notify(run: CronRunRecord, ...args: unknown[]): Promise<void>;
}

function toNotification(event: CronLedgerEvent): CronLiveNotification {
  const notification: CronLiveNotification = {
    id: event.id,
    runId: event.runId,
    phase: event.phase,
    jobName: event.jobName,
    cron: event.cron,
    scheduledTime: event.scheduledTime,
    occurredAt: event.occurredAt,
    status: event.status,
  };
  if (event.dispatchId) notification.dispatchId = event.dispatchId;
  if (event.attempt !== undefined) notification.attempt = event.attempt;
  if (event.durationMs !== undefined) notification.durationMs = event.durationMs;
  if (event.project) notification.project = event.project;
  if (event.deployment) notification.deployment = event.deployment;
  const error = sanitizeCronErrorSummary(event.error);
  if (error) notification.error = error;
  return notification;
}

/**
 * Publish small run notifications after authoritative persistence. The stream
 * is at most once and is not stored; clients must refetch after reconnect.
 */
export function createCronLiveNotifier(options: CronLiveNotifierOptions): CronLiveNotifier {
  const type = options.type ?? "cron-run";
  const createId = options.createId ?? ((event: CronLedgerEvent) => `live:${event.id}`);

  const publish = async (event: CronLedgerEvent): Promise<CronLivePublishResult> => {
    const notification = toNotification(event);
    const topic = typeof options.topic === "function" ? options.topic(event) : options.topic;
    if (topic.trim().length === 0) {
      return {
        published: false,
        event: notification,
        error: { name: "Error", message: "live topic must not be empty" },
      };
    }
    try {
      await options.stream.publish(topic, notification, { type, eventId: createId(event) });
      return { published: true, event: notification };
    } catch (error) {
      return { published: false, event: notification, error: summarizeCronError(error) };
    }
  };

  return {
    publish,
    notify: async (run) => {
      const event = cronRunToLedgerEvent(run);
      const result = await publish(event);
      if (!result.published) {
        try {
          await options.onError?.(result.error, event);
        } catch {}
      }
    },
  };
}

export interface CronTopicAuthorizerOptions<TContext> {
  authorize: (topic: string, context: TContext) => boolean | Promise<boolean>;
  isOperationalTopic?: (topic: string) => boolean;
}

/**
 * Fail-closed topic authorization for `live.onSubscribe`. A thrown auth check
 * denies the subscription.
 */
export function createCronTopicAuthorizer<TContext>(
  options: CronTopicAuthorizerOptions<TContext>,
): (topic: string, context: TContext) => Promise<boolean> {
  return async (topic, context) => {
    if (options.isOperationalTopic && !options.isOperationalTopic(topic)) return false;
    try {
      return (await options.authorize(topic, context)) === true;
    } catch {
      return false;
    }
  };
}
