// void@1.1.11 generates `.void/queues.d.ts` as a standalone module rather than
// augmenting `void/queues`. Bridge it so the typed producer proxy knows about
// the consumers in `queues/`. Regenerated queue types flow in automatically.
import type { QueueMap as GeneratedQueueMap } from '../.void/queues';

declare module 'void/queues' {
  interface QueueMap extends GeneratedQueueMap {}
}
