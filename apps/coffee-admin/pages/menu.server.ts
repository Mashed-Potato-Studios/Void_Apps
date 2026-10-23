import { defineHandler } from 'void';
import type { InferProps } from 'void';
import type { MenuItem } from '@void-monorepo/coffee-contract';
import { env } from 'void/env';
import { coffeeApi } from '../src/api.js';

export const loader = defineHandler(async () => {
  try {
    return { items: await coffeeApi.getAdminMenu(), error: null, siteUrl: env.COFFEE_SITE_URL };
  } catch (cause) {
    console.log('[coffee-admin] menu failed:', cause instanceof Error ? cause.message : String(cause));
    return {
      items: [] as MenuItem[],
      error: 'Could not load the menu from the coffee API.',
      siteUrl: env.COFFEE_SITE_URL,
    };
  }
});

export type Props = InferProps<typeof loader>;
