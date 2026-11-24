import { defineHandler } from 'void';
import { queues } from 'void/queues';
import { adminOnly } from '../../../src/admin.js';
import type { OrderEvent } from '../../../queues/order-events.js';

/**
 * Admin producer for the `order-events` queue. The typed proxy comes from the
 * `defineQueue<OrderEvent>` generic in `queues/order-events.ts` (regenerated in
 * `.void/queues.d.ts` by `void build` / `void dev`).
 */
export const POST = defineHandler(adminOnly, async (c) => {
  try {
    const input = (await c.req.json()) as Partial<OrderEvent>;
    if (typeof input.orderId !== 'string' || input.orderId.length === 0 ||
      (input.type !== 'created' && input.type !== 'restocked')) {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_EVENT', message: 'orderId and type ("created" | "restocked") are required' },
        },
        400,
      );
    }
    const event: OrderEvent = {
      orderId: input.orderId,
      type: input.type,
      itemCount: input.itemCount ?? 0,
      totalCents: input.totalCents ?? 0,
    };
    await queues['order-events'].send(event);
    return { success: true, data: { queue: 'order-events', event } };
  } catch (cause) {
    console.log('[coffee/admin/queues] enqueue failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      { success: false, error: { code: 'QUEUE_UNAVAILABLE', message: 'Could not enqueue the order event' } },
      503,
    );
  }
});
