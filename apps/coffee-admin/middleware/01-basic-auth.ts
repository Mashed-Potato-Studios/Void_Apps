import { basicAuth } from 'void';
import { env } from 'void/env';

/**
 * Staff gate. Basic auth is intentionally boring: every admin request —
 * pages, loaders, actions, and the API proxy — is blocked before it reaches
 * app code, and the coffee admin token stays server-side.
 */
export default basicAuth({
  username: () => env.ADMIN_USERNAME,
  password: () => env.ADMIN_PASSWORD,
  realm: 'Crew Coffee Admin',
});
