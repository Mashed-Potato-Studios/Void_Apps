import { defineEnv, url } from 'void/env';

export default defineEnv({
  /** Coffee API origin, resolved server-side for loaders and the checkout proxy. */
  COFFEE_API_URL: url(),
  /** Admin console origin, used only for the “Staff” nav link. */
  COFFEE_ADMIN_URL: url(),
});
