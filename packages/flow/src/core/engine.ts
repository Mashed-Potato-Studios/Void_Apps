import type {
  WorkflowDefinition,
  FlowStorageAdapter,
  WorkflowExecution,
} from '../types';
import { StepContextImpl, WorkflowPauseSignal } from './step';

export class WorkflowEngine {
  private workflows = new Map<string, WorkflowDefinition<any, any>>();

  constructor(
    private readonly storage: FlowStorageAdapter,
    private readonly queueDispatcher?: (queueName: string, payload: unknown) => Promise<void>
  ) {}

  registerWorkflow<TInput, TOutput>(workflow: WorkflowDefinition<TInput, TOutput>): void {
    this.workflows.set(workflow.name, workflow);
  }

  getWorkflow(name: string): WorkflowDefinition | undefined {
    return this.workflows.get(name);
  }

  /**
   * Start or resume execution of a workflow
   */
  async execute<TInput, TOutput>(
    workflowName: string,
    input: TInput,
    options?: { executionId?: string }
  ): Promise<WorkflowExecution<TInput, TOutput>> {
    const workflow = this.workflows.get(workflowName);
    if (!workflow) {
      throw new Error(`Workflow "${workflowName}" is not registered in Void Flow engine.`);
    }

    const executionId =
      options?.executionId || `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    let execution = await this.storage.getExecution(executionId);

    if (!execution) {
      execution = await this.storage.createExecution({
        id: executionId,
        workflowName,
        status: 'running',
        input,
        currentStepIndex: 0,
        createdAt: new Date().toISOString(),
      });
    } else {
      execution = await this.storage.updateExecution(executionId, {
        status: 'running',
        error: undefined,
      });
    }

    const stepContext = new StepContextImpl(
      executionId,
      this.storage,
      this.queueDispatcher
    );

    try {
      // Execute the workflow logic with deterministic step memoization
      const output = await workflow.handler({
        step: stepContext,
        input,
        executionId,
      });

      // Workflow successfully finished all steps
      const completedExecution = await this.storage.updateExecution(executionId, {
        status: 'completed',
        output,
        completedAt: new Date().toISOString(),
        wakeUpAt: undefined,
        waitingForEventName: undefined,
      });

      return completedExecution as WorkflowExecution<TInput, TOutput>;
    } catch (err: unknown) {
      if (err instanceof WorkflowPauseSignal) {
        // Workflow paused gracefully due to sleep or event waiting
        const status = err.reason === 'sleep' ? 'sleeping' : 'waiting_event';
        const pausedExecution = await this.storage.updateExecution(executionId, {
          status,
          wakeUpAt: err.metadata?.wakeUpAt,
          waitingForEventName: err.metadata?.eventName,
        });

        return pausedExecution as WorkflowExecution<TInput, TOutput>;
      }

      // True execution error
      const errorMessage = err instanceof Error ? err.message : String(err);
      const failedExecution = await this.storage.updateExecution(executionId, {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      });

      return failedExecution as WorkflowExecution<TInput, TOutput>;
    }
  }

  /**
   * Resume sleeping workflows whose wakeUpAt has arrived (Called by Cloudflare Cron jobs)
   */
  async processSleepingWorkflows(): Promise<number> {
    const sleepingExecutions = await this.storage.listExecutions({ status: 'sleeping' });
    const now = Date.now();
    let resumedCount = 0;

    for (const execution of sleepingExecutions) {
      if (execution.wakeUpAt && new Date(execution.wakeUpAt).getTime() <= now) {
        // Mark step as completed and resume
        const steps = await this.storage.getStepsForExecution(execution.id);
        const lastStep = steps[steps.length - 1];
        if (lastStep && lastStep.stepType === 'sleep') {
          lastStep.status = 'completed';
          lastStep.completedAt = new Date().toISOString();
          await this.storage.saveStep(lastStep);
        }

        await this.execute(execution.workflowName, execution.input, {
          executionId: execution.id,
        });
        resumedCount++;
      }
    }

    return resumedCount;
  }

  /**
   * Receive an external event and resume any waiting workflows
   */
  async dispatchEvent(eventName: string, payload: unknown, executionId?: string): Promise<number> {
    await this.storage.saveEvent({
      eventName,
      executionId,
      payload,
    });

    const waitingExecutions = await this.storage.listExecutions({ status: 'waiting_event' });
    let resumedCount = 0;

    for (const execution of waitingExecutions) {
      if (
        execution.waitingForEventName === eventName &&
        (!executionId || execution.id === executionId)
      ) {
        await this.execute(execution.workflowName, execution.input, {
          executionId: execution.id,
        });
        resumedCount++;
      }
    }

    return resumedCount;
  }
}
