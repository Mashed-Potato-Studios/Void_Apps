import type {
  StepContext,
  DurationString,
  FlowStorageAdapter,
  WorkflowStepRecord,
} from '../types.js';

/**
 * Utility to parse duration strings into milliseconds
 * Supports: '30s', '10m', '2h', '7d', or raw ms numbers
 */
export function parseDurationMs(duration: DurationString | number): number {
  if (typeof duration === 'number') {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(
        `Invalid duration: ${duration}. Expected a finite, non-negative number of milliseconds.`
      );
    }
    return duration;
  }

  const match = duration.trim().match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}". Expected format like "30s", "10m", "2h", "7d".`);
  }

  const [, valStr, unit] = match;
  if (valStr === undefined || unit === undefined) {
    throw new Error(`Invalid duration format: "${duration}". Expected format like "30s", "10m", "2h", "7d".`);
  }
  const val = parseInt(valStr, 10);

  switch (unit) {
    case 's':
      return val * 1000;
    case 'm':
      return val * 60 * 1000;
    case 'h':
      return val * 60 * 60 * 1000;
    case 'd':
      return val * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unsupported duration unit: "${unit}"`);
  }
}

/**
 * Signal error thrown to halt execution gracefully when sleeping or waiting for event.
 */
export class WorkflowPauseSignal extends Error {
  public readonly reason: 'sleep' | 'wait_for_event';
  public readonly stepId: string;
  public readonly metadata?: { wakeUpAt?: string; eventName?: string };

  constructor(
    reason: 'sleep' | 'wait_for_event',
    stepId: string,
    metadata?: { wakeUpAt?: string; eventName?: string }
  ) {
    super(`Workflow paused: ${reason} at step "${stepId}"`);
    this.name = 'WorkflowPauseSignal';
    this.reason = reason;
    this.stepId = stepId;
    this.metadata = metadata;
  }
}

export class StepContextImpl implements StepContext {
  private readonly executionId: string;
  private readonly storage: FlowStorageAdapter;
  private readonly queueDispatcher?: (queueName: string, payload: unknown) => Promise<void>;

  constructor(
    executionId: string,
    storage: FlowStorageAdapter,
    queueDispatcher?: (queueName: string, payload: unknown) => Promise<void>
  ) {
    this.executionId = executionId;
    this.storage = storage;
    this.queueDispatcher = queueDispatcher;
  }

  async run<T>(stepId: string, fn: () => Promise<T>): Promise<T> {
    const existingStep = await this.storage.getStep(this.executionId, stepId);

    // If step was already completed, return memoized result immediately
    if (existingStep && existingStep.status === 'completed') {
      return existingStep.output as T;
    }

    const startTime = Date.now();
    const stepRecord: WorkflowStepRecord = {
      id: `step_${crypto.randomUUID()}`,
      executionId: this.executionId,
      stepId,
      stepType: 'run',
      status: 'running',
      attempts: (existingStep?.attempts || 0) + 1,
      createdAt: new Date().toISOString(),
    };

    await this.storage.saveStep(stepRecord);

    try {
      const result = await fn();
      const durationMs = Date.now() - startTime;

      stepRecord.status = 'completed';
      stepRecord.output = result;
      stepRecord.durationMs = durationMs;
      stepRecord.completedAt = new Date().toISOString();

      await this.storage.saveStep(stepRecord);
      return result;
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      stepRecord.status = 'failed';
      stepRecord.error = errorMessage;
      stepRecord.durationMs = durationMs;
      stepRecord.completedAt = new Date().toISOString();

      await this.storage.saveStep(stepRecord);
      throw err;
    }
  }

  async sleep(stepId: string, duration: DurationString | number): Promise<void> {
    const existingStep = await this.storage.getStep(this.executionId, stepId);

    if (existingStep && existingStep.status === 'completed') {
      return;
    }

    const durationMs = parseDurationMs(duration);
    const wakeUpAt = new Date(Date.now() + durationMs).toISOString();

    const stepRecord: WorkflowStepRecord = {
      id: `step_${crypto.randomUUID()}`,
      executionId: this.executionId,
      stepId,
      stepType: 'sleep',
      status: 'running',
      attempts: 1,
      createdAt: new Date().toISOString(),
    };
    await this.storage.saveStep(stepRecord);

    // Signal engine to pause workflow and schedule wakeup
    throw new WorkflowPauseSignal('sleep', stepId, { wakeUpAt });
  }

  async waitForEvent<T = unknown>(
    stepId: string,
    options: { eventName: string; timeout?: DurationString | number }
  ): Promise<T> {
    const existingStep = await this.storage.getStep(this.executionId, stepId);

    if (existingStep && existingStep.status === 'completed') {
      return existingStep.output as T;
    }

    // Check if an event is already waiting to be consumed
    const event = await this.storage.consumeEvent(options.eventName, this.executionId);
    if (event) {
      const stepRecord: WorkflowStepRecord = {
        id: `step_${crypto.randomUUID()}`,
        executionId: this.executionId,
        stepId,
        stepType: 'wait_for_event',
        status: 'completed',
        output: event.payload,
        attempts: 1,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      await this.storage.saveStep(stepRecord);
      return event.payload as T;
    }

    const stepRecord: WorkflowStepRecord = {
      id: `step_${crypto.randomUUID()}`,
      executionId: this.executionId,
      stepId,
      stepType: 'wait_for_event',
      status: 'running',
      attempts: 1,
      createdAt: new Date().toISOString(),
    };
    await this.storage.saveStep(stepRecord);

    // Pause workflow and wait for external event
    throw new WorkflowPauseSignal('wait_for_event', stepId, { eventName: options.eventName });
  }

  async sendQueue(stepId: string, queueName: string, payload: unknown): Promise<void> {
    await this.run(stepId, async () => {
      if (this.queueDispatcher) {
        await this.queueDispatcher(queueName, payload);
      } else {
        console.log(`[Void Flow] Dispatched to queue "${queueName}":`, payload);
      }
      return { sent: true, queueName, timestamp: new Date().toISOString() };
    });
  }
}
