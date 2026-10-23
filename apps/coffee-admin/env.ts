declare module 'void/env' {
  interface ValidatedEnv {
    COFFEE_API_URL: string;
    COFFEE_SITE_URL: string;
    COFFEE_ADMIN_TOKEN: string;
    ADMIN_USERNAME: string;
    ADMIN_PASSWORD: string;
  }
}

import { defineEnv, string, url } from 'void/env';

export default defineEnv({
  COFFEE_API_URL: url(),
  COFFEE_SITE_URL: url(),
  /** Must match the API's COFFEE_ADMIN_TOKEN. */
  COFFEE_ADMIN_TOKEN: string(),
  ADMIN_USERNAME: string(),
  ADMIN_PASSWORD: string(),
});
