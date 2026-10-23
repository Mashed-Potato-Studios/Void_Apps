import { defineHandler } from 'void';
import { env } from 'void/env';

/**
 * BFF proxy for admin mutations. The browser talks only to this app; the
 * bearer token is attached here, server-side. The global basic-auth
 * middleware already gates this route.
 */
const proxy = defineHandler(async (c) => {
  const path = c.req.param('path') ?? '';
  const url = new URL(`/api/admin/${path}`, env.COFFEE_API_URL);
  url.search = new URL(c.req.url).search;

  const method = c.req.method.toUpperCase();
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.COFFEE_ADMIN_TOKEN}`,
    accept: 'application/json',
  };
  const contentType = c.req.header('content-type');
  if (contentType) headers['content-type'] = contentType;

  const hasBody = method !== 'GET' && method !== 'HEAD';

  try {
    const upstream = await fetch(url, {
      method,
      headers,
      body: hasBody ? await c.req.text() : undefined,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (cause) {
    console.log('[coffee-admin] proxy failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      {
        success: false,
        error: { code: 'API_UNAVAILABLE', message: 'Coffee API is unreachable' },
      },
      503,
    );
  }
});

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
