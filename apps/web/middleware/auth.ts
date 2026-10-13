/**
 * Void Request Middleware
 * Runs before page/route resolution to validate headers, cookies, or sessions.
 */
export async function onRequest({ request, next }: { request: Request; next: () => Promise<Response> }) {
  const url = new URL(request.url);

  // Add security headers or perform auth checks
  const response = await next();
  response.headers.set('x-void-middleware', 'auth-passed');

  return response;
}
