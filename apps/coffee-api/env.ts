declare module 'void/env' {
  interface ValidatedEnv {
    COFFEE_ADMIN_TOKEN: string;
    COFFEE_ALLOWED_ORIGINS: string;
  }
}

import { defineEnv, string } from 'void/env';

export default defineEnv({
  /** Bearer token required by every `/api/admin/*` route. Set with `void secret put`. */
  COFFEE_ADMIN_TOKEN: string(),
  /** Comma-separated browser origins allowed to call the public API. */
  COFFEE_ALLOWED_ORIGINS: string().default('http://localhost:5173,http://localhost:5174'),
});
