import { defineQueue } from 'void';

/**
 * Coffee order lifecycle events. Void names this queue `order-events` from the
 * path in `queues/`. Messages arrive from `void/queues` producers in the app or
 * from `void-crons queue-send` during local development.
 *
 * Ack/retry policy is app-owned: the first decision wins per message. Keep the
 * handler idempotent — a retried delivery may run more than once.
 */
export interface OrderEvent {
  orderId: string;
  type: 'created' | 'restocked';
  itemCount: number;
  totalCents: number;
}

export const maxBatchSize = 25;
export const maxBatchTimeout = 5;
export const maxRetries = 3;
export const retryDelay = 10;

export default defineQueue<OrderEvent>(async (batch) => {
  for (const message of batch.messages) {
    try {
      const event = message.body;
      if (!event || typeof event.orderId !== 'string' || typeof event.type !== 'string') {
        throw new Error('invalid order event body');
      }
      // Visible in the Void dev server log when the batch is dispatched.
      console.log(
        `[coffee-api:order-events] ${event.type} order=${event.orderId} items=${event.itemCount ?? 0} ` +
          `total=${event.totalCents ?? 0}c attempts=${message.attempts} at=${message.timestamp.toISOString()}`,
      );
      message.ack();
    } catch (error) {
      console.error('[coffee-api:order-events] retrying message', message.id, error);
      message.retry({ delaySeconds: 10 });
    }
  }
});
