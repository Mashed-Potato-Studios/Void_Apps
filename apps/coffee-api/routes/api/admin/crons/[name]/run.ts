import { defineHandler } from 'void';
import { adminOnly } from '../../../../../src/admin.js';
import { executeJob, findJob } from '../../../../../src/jobs/index.js';

/** Runs a job immediately and records it with `trigger: "manual"`. */
export const POST = defineHandler(adminOnly, async (c) => {
  const name = c.req.param('name') ?? '';
  const job = findJob(name);
  if (!job) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: `No cron job "${name}"` } },
      404,
    );
  }
  const run = await executeJob(job, Date.now(), 'manual');
  return { success: true, data: run };
});
