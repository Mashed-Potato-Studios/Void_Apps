import { defineHandler } from 'void';
import { adminOnly } from '../../../../src/admin.js';
import { COFFEE_CRON_LEDGER_TABLE, getCoffeeCronLedger } from '../../../../src/cron-ledger.js';

export const GET = defineHandler(adminOnly, async (c) => {
  const requested = Number(c.req.query('limit') ?? 50);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(200, Math.floor(requested))) : 50;
  try {
    const store = await getCoffeeCronLedger();
    return {
      success: true,
      data: {
        table: COFFEE_CRON_LEDGER_TABLE,
        runs: await store.list(limit),
      },
    };
  } catch (cause) {
    console.log('[coffee/admin/crons/ledger] failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      {
        success: false,
        error: { code: 'CRON_LEDGER_UNAVAILABLE', message: 'Cron ledger is not ready yet' },
      },
      503,
    );
  }
});
