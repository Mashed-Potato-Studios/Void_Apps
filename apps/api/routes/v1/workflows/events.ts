import { defineHandler } from 'void';
import { flowClient } from '../../../workflows/onboarding.js';

// POST /api/v1/workflows/events - Dispatch an event to resume waiting workflows
export const POST = defineHandler(async ({ request }: { request: Request }) => {
  const body = (await request.json()) as {
    eventName?: string;
    payload?: unknown;
    executionId?: string;
  };

  if (!body.eventName) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'eventName is required' },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const result = await flowClient.sendEvent(
    body.eventName,
    body.payload || { timestamp: new Date().toISOString() },
    body.executionId
  );

  return {
    success: true,
    data: result,
  };
});
