import { defineHandler } from 'void';
import type { InferProps } from 'void';
import type { Order } from '@void-monorepo/coffee-contract';
import { env } from 'void/env';
import { coffeeApi } from '../src/api.js';

export const loader = defineHandler(async () => {
  try {
    return { orders: await coffeeApi.getOrders(100), error: null, siteUrl: env.COFFEE_SITE_URL };
  } catch (cause) {
    console.log('[coffee-admin] orders failed:', cause instanceof Error ? cause.message : String(cause));
    return {
      orders: [] as Order[],
      error: 'Could not load orders from the coffee API.',
      siteUrl: env.COFFEE_SITE_URL,
    };
  }
});

export type Props = InferProps<typeof loader>;
