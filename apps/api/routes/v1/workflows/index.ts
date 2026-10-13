import { defineHandler } from 'void';
import { flowClient, userOnboardingWorkflow } from '../../../workflows/onboarding.js';

// GET /api/v1/workflows - List all executions or get specific execution by id
export const GET = defineHandler(async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const executionId = url.searchParams.get('id');

  if (executionId) {
    const data = await flowClient.getExecution(executionId);
    if (!data.execution) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow execution not found' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return { success: true, data };
  }

  const executions = await flowClient.listExecutions();
  return {
    success: true,
    data: executions,
  };
});

// POST /api/v1/workflows - Trigger a new workflow
export const POST = defineHandler(async ({ request }: { request: Request }) => {
  const body = (await request.json()) as {
    workflowName?: string;
    input?: { userId: string; email: string; name: string; plan?: 'free' | 'pro' | 'enterprise' };
  };

  const input = {
    userId: body.input?.userId || `user_${Date.now()}`,
    email: body.input?.email || 'dev@example.com',
    name: body.input?.name || 'Alex Developer',
    plan: body.input?.plan || 'pro',
  };

  const execution = await flowClient.start(userOnboardingWorkflow, input);

  return {
    success: true,
    data: execution,
  };
});
