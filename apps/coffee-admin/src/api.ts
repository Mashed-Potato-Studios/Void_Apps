import { createCoffeeClient } from '@void-monorepo/coffee-contract';
import { env } from 'void/env';

/** Server-side only: carries the admin token, never bundled for the browser. */
export const coffeeApi = createCoffeeClient({
  baseUrl: env.COFFEE_API_URL,
  adminToken: env.COFFEE_ADMIN_TOKEN,
});
