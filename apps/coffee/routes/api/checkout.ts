import { defineHandler } from 'void';
import { env } from 'void/env';

/**
 * Same-origin checkout proxy. Keeps the API origin server-side, so the browser
 * never needs CORS or a second deploy URL, and keeps the browser off the API
 * admin surface entirely.
 */
export const POST = defineHandler(async (c) => {
  const body = await c.req.text();
  try {
    const upstream = await fetch(`${env.COFFEE_API_URL.replace(/\/+$/, '')}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (cause) {
    console.log('[coffee/checkout] upstream failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      {
        success: false,
        error: { code: 'API_UNAVAILABLE', message: 'The counter is offline. Please try again.' },
      },
      503,
    );
  }
});
