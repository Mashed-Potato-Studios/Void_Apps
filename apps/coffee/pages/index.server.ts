import { defineHandler } from 'void';
import type { InferProps } from 'void';
import { env } from 'void/env';
import { createCoffeeClient, type MenuItem } from '@void-monorepo/coffee-contract';

export interface StorefrontData {
  menu: MenuItem[];
  menuError: string | null;
  adminUrl: string;
}

/**
 * The café is a pure frontend: the menu comes from the coffee API so stock
 * updates, admin edits, and nightly restocks are visible without a rebuild.
 */
export const loader = defineHandler(async (): Promise<StorefrontData> => {
  const client = createCoffeeClient({ baseUrl: env.COFFEE_API_URL });
  try {
    return { menu: await client.getMenu(), menuError: null, adminUrl: env.COFFEE_ADMIN_URL };
  } catch (cause) {
    console.log('[coffee] menu unavailable:', cause instanceof Error ? cause.message : String(cause));
    return {
      menu: [],
      menuError: 'The menu is being restocked. Please try again in a moment.',
      adminUrl: env.COFFEE_ADMIN_URL,
    };
  }
});

export type Props = InferProps<typeof loader>;
