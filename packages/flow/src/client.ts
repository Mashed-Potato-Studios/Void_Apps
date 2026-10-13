import type {
  WorkflowDefinition,
  FlowStorageAdapter,
  WorkflowExecution,
  WorkflowStepRecord,
} from './types';
import { WorkflowEngine } from './core/engine';
import { MemoryStorageAdapter } from './storage/adapter';

export interface VoidFlowClientOptions {
  storage?: FlowStorageAdapter;
  queueDispatcher?: (queueName: string, payload: unknown) => Promise<void>;
}

export class VoidFlowClient {
  public readonly engine: WorkflowEngine;
  public readonly storage: FlowStorageAdapter;

  constructor(options?: VoidFlowClientOptions) {
    this.storage = options?.storage || new MemoryStorageAdapter();
    this.engine = new WorkflowEngine(this.storage, options?.queueDispatcher);
  }

  registerWorkflow<TInput, TOutput>(workflow: WorkflowDefinition<TInput, TOutput>): this {
    this.engine.registerWorkflow(workflow);
    return this;
  }

  async start<TInput, TOutput>(
    workflow: WorkflowDefinition<TInput, TOutput> | string,
    input: TInput,
    options?: { executionId?: string }
  ): Promise<WorkflowExecution<TInput, TOutput>> {
    const name = typeof workflow === 'string' ? workflow : workflow.name;
    if (typeof workflow !== 'string') {
      this.engine.registerWorkflow(workflow);
    }
    return this.engine.execute<TInput, TOutput>(name, input, options);
  }

  async sendEvent(
    eventName: string,
    payload: unknown,
    executionId?: string
  ): Promise<{ resumedCount: number }> {
    const resumedCount = await this.engine.dispatchEvent(eventName, payload, executionId);
    return { resumedCount };
  }

  async processSleeping(): Promise<{ resumedCount: number }> {
    const resumedCount = await this.engine.processSleepingWorkflows();
    return { resumedCount };
  }

  async getExecution(id: string): Promise<{
    execution: WorkflowExecution | null;
    steps: WorkflowStepRecord[];
  }> {
    const execution = await this.storage.getExecution(id);
    const steps = execution ? await this.storage.getStepsForExecution(id) : [];
    return { execution, steps };
  }

  async listExecutions(filter?: {
    workflowName?: string;
    status?: WorkflowExecution['status'];
  }): Promise<WorkflowExecution[]> {
    return this.storage.listExecutions(filter);
  }
}

export function createFlowClient(options?: VoidFlowClientOptions): VoidFlowClient {
  return new VoidFlowClient(options);
}
