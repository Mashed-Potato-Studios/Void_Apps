import { defineHandler } from 'void';
import type { InferProps } from 'void';
import type { CronStatus } from '@void-monorepo/coffee-contract';
import { env } from 'void/env';
import { coffeeApi } from '../src/api.js';

export const loader = defineHandler(async () => {
  try {
    return { status: await coffeeApi.getCronStatus(), error: null, siteUrl: env.COFFEE_SITE_URL };
  } catch (cause) {
    console.log('[coffee-admin] crons failed:', cause instanceof Error ? cause.message : String(cause));
    return {
      status: null as CronStatus | null,
      error: 'Could not load cron jobs and run history from the coffee API.',
      siteUrl: env.COFFEE_SITE_URL,
    };
  }
});

export type Props = InferProps<typeof loader>;
