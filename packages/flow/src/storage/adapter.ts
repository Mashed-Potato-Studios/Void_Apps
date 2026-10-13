import type {
  FlowStorageAdapter,
  WorkflowExecution,
  WorkflowStepRecord,
  WorkflowEventRecord,
  WorkflowStatus,
} from '../types.js';

/**
 * In-Memory storage adapter for testing and lightweight runtime environments.
 */
export class MemoryStorageAdapter implements FlowStorageAdapter {
  private executions = new Map<string, WorkflowExecution>();
  private steps = new Map<string, WorkflowStepRecord>();
  private events: WorkflowEventRecord[] = [];

  async createExecution(
    data: Omit<WorkflowExecution, 'updatedAt'>
  ): Promise<WorkflowExecution> {
    const execution: WorkflowExecution = {
      ...data,
      updatedAt: new Date().toISOString(),
    };
    this.executions.set(execution.id, execution);
    return execution;
  }

  async getExecution(id: string): Promise<WorkflowExecution | null> {
    return this.executions.get(id) || null;
  }

  async updateExecution(
    id: string,
    updates: Partial<WorkflowExecution>
  ): Promise<WorkflowExecution> {
    const current = this.executions.get(id);
    if (!current) {
      throw new Error(`Execution ${id} not found`);
    }
    const updated: WorkflowExecution = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.executions.set(id, updated);
    return updated;
  }

  async listExecutions(filter?: {
    workflowName?: string;
    status?: WorkflowStatus;
  }): Promise<WorkflowExecution[]> {
    let list = Array.from(this.executions.values());
    if (filter?.workflowName) {
      list = list.filter((e) => e.workflowName === filter.workflowName);
    }
    if (filter?.status) {
      list = list.filter((e) => e.status === filter.status);
    }
    return list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getStep(
    executionId: string,
    stepId: string
  ): Promise<WorkflowStepRecord | null> {
    const key = `${executionId}:${stepId}`;
    return this.steps.get(key) || null;
  }

  async saveStep(step: WorkflowStepRecord): Promise<void> {
    const key = `${step.executionId}:${step.stepId}`;
    this.steps.set(key, step);
  }

  async getStepsForExecution(
    executionId: string
  ): Promise<WorkflowStepRecord[]> {
    return Array.from(this.steps.values())
      .filter((s) => s.executionId === executionId)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }

  async saveEvent(
    eventData: Omit<WorkflowEventRecord, 'id' | 'createdAt' | 'consumed'>
  ): Promise<WorkflowEventRecord> {
    const event: WorkflowEventRecord = {
      id: `evt_${crypto.randomUUID()}`,
      ...eventData,
      consumed: false,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async consumeEvent(
    eventName: string,
    executionId?: string
  ): Promise<WorkflowEventRecord | null> {
    const event = this.events.find(
      (e) =>
        !e.consumed &&
        e.eventName === eventName &&
        (!executionId || !e.executionId || e.executionId === executionId)
    );

    if (event) {
      event.consumed = true;
      return event;
    }
    return null;
  }
}
