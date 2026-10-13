/**
 * @void-monorepo/flow Types
 * Core definitions for durable workflows, step memoization, and state transitions.
 */

export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'sleeping'
  | 'waiting_event'
  | 'completed'
  | 'failed'
  | 'canceled';

export type StepStatus = 'running' | 'completed' | 'failed' | 'skipped';

export type StepType = 'run' | 'sleep' | 'wait_for_event' | 'send_queue';

export type DurationString = `${number}${'s' | 'm' | 'h' | 'd'}`;

export interface WorkflowExecution<TInput = unknown, TOutput = unknown> {
  id: string;
  workflowName: string;
  status: WorkflowStatus;
  input: TInput;
  output?: TOutput;
  error?: string;
  currentStepIndex: number;
  wakeUpAt?: string;
  waitingForEventName?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkflowStepRecord {
  id: string;
  executionId: string;
  stepId: string;
  stepType: StepType;
  status: StepStatus;
  output?: unknown;
  error?: string;
  durationMs?: number;
  attempts: number;
  createdAt: string;
  completedAt?: string;
}

export interface WorkflowEventRecord {
  id: string;
  eventName: string;
  executionId?: string;
  payload: unknown;
  consumed: boolean;
  createdAt: string;
}

export interface StepContext {
  /**
   * Execute and memoize a deterministic side-effect.
   * If already completed, returns the cached result without re-executing.
   */
  run<T>(stepId: string, fn: () => Promise<T>): Promise<T>;

  /**
   * Durably pause workflow execution until the given duration elapses.
   */
  sleep(stepId: string, duration: DurationString | number): Promise<void>;

  /**
   * Durably pause execution until a specific external event arrives.
   */
  waitForEvent<T = unknown>(
    stepId: string,
    options: { eventName: string; timeout?: DurationString | number }
  ): Promise<T>;

  /**
   * Dispatch a message to a Cloudflare Queue.
   */
  sendQueue(stepId: string, queueName: string, payload: unknown): Promise<void>;
}

export type WorkflowHandler<TInput, TOutput> = (context: {
  step: StepContext;
  input: TInput;
  executionId: string;
}) => Promise<TOutput>;

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  handler: WorkflowHandler<TInput, TOutput>;
}

export interface FlowStorageAdapter {
  createExecution(execution: Omit<WorkflowExecution, 'updatedAt'>): Promise<WorkflowExecution>;
  getExecution(id: string): Promise<WorkflowExecution | null>;
  updateExecution(
    id: string,
    updates: Partial<WorkflowExecution>
  ): Promise<WorkflowExecution>;
  listExecutions(filter?: { workflowName?: string; status?: WorkflowStatus }): Promise<WorkflowExecution[]>;
  getStep(executionId: string, stepId: string): Promise<WorkflowStepRecord | null>;
  saveStep(step: WorkflowStepRecord): Promise<void>;
  getStepsForExecution(executionId: string): Promise<WorkflowStepRecord[]>;
  saveEvent(event: Omit<WorkflowEventRecord, 'id' | 'createdAt' | 'consumed'>): Promise<WorkflowEventRecord>;
  consumeEvent(eventName: string, executionId?: string): Promise<WorkflowEventRecord | null>;
}
