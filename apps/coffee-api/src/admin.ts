import { defineMiddleware } from 'void';
import { env } from 'void/env';

/**
 * Guards `/api/admin/*`. The token never reaches a browser: the admin app
 * injects it server-side, and the café only uses public routes.
 */
export const adminOnly = defineMiddleware(async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(header);
  const token = match?.[1] ?? '';
  if (!token || token !== env.COFFEE_ADMIN_TOKEN) {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Admin token required' } },
      401,
    );
  }
  await next();
});

export function jsonError(
  c: { json: (body: unknown, status?: number) => Response },
  status: number,
  code: string,
  message: string,
): Response {
  return c.json({ success: false, error: { code, message } }, status);
}
