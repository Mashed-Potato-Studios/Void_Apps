/**
 * API Request Logger & Tracing Middleware
 */
export async function onRequest({ request, next }: { request: Request; next: () => Promise<Response> }) {
  const start = Date.now();
  const { method, url } = request;

  const response = await next();
  const duration = Date.now() - start;

  console.log(`[API ${method}] ${new URL(url).pathname} -> ${response.status} (${duration}ms)`);
  response.headers.set('x-response-time', `${duration}ms`);

  return response;
}
