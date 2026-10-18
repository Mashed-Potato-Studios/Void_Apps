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
];

export const COFFEE_MANIFEST = { expressionCount: 2, scheduleCount: 2 };

// return shape must align with the client page props exactly
export type CronsLoader = {
  jobs: CronJob[];
  activity: CronActivityEntry[];
  expressionCount: number;
  scheduleCount: number;
};
