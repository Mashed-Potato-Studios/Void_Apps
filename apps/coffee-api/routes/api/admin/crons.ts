import { defineHandler } from 'void';
import { db, desc } from 'void/db';
import { adminOnly } from '../../../src/admin.js';
import { jobs } from '../../../src/jobs/index.js';
import { cronRuns } from '../../../db/schema.js';

export const GET = defineHandler(adminOnly, async (c) => {
  try {
    const runs = await db.select().from(cronRuns).orderBy(desc(cronRuns.startedAt)).limit(50);
    return {
      success: true,
      data: {
        jobs: jobs.map(({ name, path, cron, description }) => ({
          name,
          path,
          expressions: [cron],
          description,
        })),
        runs,
        expressionCount: new Set(jobs.map((job) => job.cron)).size,
        scheduleCount: jobs.length,
      },
    };
  } catch (cause) {
    console.log('[coffee/admin/crons] failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      {
        success: false,
        error: { code: 'DB_UNAVAILABLE', message: 'Cron history is not ready yet' },
      },
      503,
    );
  }
});
