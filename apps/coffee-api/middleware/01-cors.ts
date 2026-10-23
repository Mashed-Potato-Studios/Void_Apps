import { defineMiddleware } from 'void';
import { env } from 'void/env';

const allowMethods = 'GET,POST,PATCH,DELETE,OPTIONS';

/**
 * Browser-facing public endpoints are same-origin in production (the café's
 * checkout route proxies), but the allowlist keeps the API usable by external
 * clients without exposing admin routes to arbitrary origins.
 */
export default defineMiddleware(async (c, next) => {
  const origin = c.req.header('origin');
  const allowed = env.COFFEE_ALLOWED_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && allowed.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', allowMethods);
    c.header('Access-Control-Allow-Headers', 'content-type, authorization');
    c.header('Vary', 'Origin');
  }

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
});
