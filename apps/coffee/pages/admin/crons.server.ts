import type { CronActivityEntry, CronJob } from 'void-crons';

export const coffeeJobs: CronJob[] = [
  {
    path: 'crons/rollover.ts',
    name: 'coffee-nightly-restock',
    expressions: ['0 3 * * *'],
    status: 'active',
    usesDefineScheduled: true,
    sharedExpression: false,
  },
  {
    path: 'crons/top-coffee.ts',
    name: 'coffee-top-coffee',
    expressions: ['15 * * * *'],
    status: 'active',
    usesDefineScheduled: true,
    sharedExpression: false,
  },
  {
    path: 'crons/stock-alert.ts',
    name: 'coffee-stock-alert',
    expressions: ['30 7 * * *'],
    status: 'active',
    usesDefineScheduled: true,
    sharedExpression: false,
  },
  {
    path: 'crons/sales-digest.ts',
    name: 'coffee-sales-digest',
    expressions: ['0 18 * * 5'],
    status: 'active',
    usesDefineScheduled: true,
    sharedExpression: false,
  },
];

export const COFFEE_MANIFEST = { expressionCount: 4, scheduleCount: 4 };

// return shape must align with the client page props exactly
export type CronsLoader = {
  jobs: CronJob[];
  activity: CronActivityEntry[];
  expressionCount: number;
  scheduleCount: number;
};
