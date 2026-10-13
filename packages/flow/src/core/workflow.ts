import type { WorkflowDefinition, WorkflowHandler } from '../types';

/**
 * Creates and registers a type-safe Void Flow durable workflow
 *
 * @example
 * ```typescript
 * export const onboardingFlow = createWorkflow('onboarding', async ({ step, input }) => {
 *   const user = await step.run('create-user', async () => db.insert(input));
 *   await step.sleep('wait-trial', '3d');
 *   await step.sendQueue('email-queue', { to: user.email, template: 'welcome' });
 *   return { success: true };
 * });
 * ```
 */
export function createWorkflow<TInput = void, TOutput = unknown>(
  name: string,
  handler: WorkflowHandler<TInput, TOutput>
): WorkflowDefinition<TInput, TOutput> {
  return {
    name,
    handler,
  };
}

export const defineWorkflow = createWorkflow;
