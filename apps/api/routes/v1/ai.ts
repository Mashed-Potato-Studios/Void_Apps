import { defineHandler } from 'void';
import type { AiCompletionRequest } from '@void-monorepo/types';

export const POST = defineHandler(async ({ request }: { request: Request }) => {
  const body = (await request.json()) as AiCompletionRequest;

  if (!body.prompt) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Prompt is required' },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // In production with Void Cloud, AI inference is bound via void/ai (Cloudflare Workers AI @cf/meta/llama-3-8b-instruct)
  const mockAiResult = `[Void AI Simulation] Response generated for prompt: "${body.prompt.slice(0, 40)}..."`;

  return {
    success: true,
    data: {
      result: mockAiResult,
      model: body.model || '@cf/meta/llama-3-8b-instruct',
      usage: {
        promptTokens: 12,
        completionTokens: 24,
        totalTokens: 36,
      },
    },
  };
});
