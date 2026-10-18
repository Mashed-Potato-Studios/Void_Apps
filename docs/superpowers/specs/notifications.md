# notifications — Spec

## Goal

New private workspace package delivering typed notifications over Void
queues: one message envelope + per-channel consumers + provider adapters,
usable from routes and flow workflows. Replaces the untyped `email.ts`
consumer and the `unknown`-typed flow queue dispatcher.

Non-goals: new transport (Void queues only); template builder UI;
SMS/push provider contracts in v1 (interfaces reserved, not implemented).

## Background

Void queues (`void.cloud/guide/queues`): consumer file path under
`queues/` determines queue name (`queues/emails.ts` → `emails`,
`queues/order/notifications.ts` → `order-notifications`); names follow
Cloudflare rules (1–63 chars, letters/digits/`-`, start/end
alphanumeric); `_`-prefixed files ignored. `defineQueue<T>` types both
the consumer and `queues.<name>.send()` from `void/queues`. Per-message
`ack()` / `retry({delaySeconds})`, plus `batch.ackAll()` /
`batch.retryAll()`; first call wins; undecided messages ack on success,
retry on throw; `timestamp` is a `Date`. Consumer knobs:
`maxBatchSize` (10), `maxBatchTimeout` (5s), `maxRetries` (3),
`retryDelay` (0s). Void-managed queues have **no DLQ** — exhausted
messages are permanently deleted. Local dev auto-invokes consumers via
Miniflare; manual dispatch via `POST /__void/queue` with dev token.

Repo today: `apps/api/queues/email.ts` is untyped (raw handler, inline
batch shape, no ack/retry); `EmailQueuePayload` in `@void-monorepo/types`
has narrow `variables`; flow `sendQueue` dispatcher is
`(queueName, payload: unknown)` and falls back to `console.log`;
onboarding workflow sends `welcome` / `notification` templates through it.

## Package

- Name `@void-monorepo/notifications`, private, `type: module`.
- `packages/notifications/`: pure lib + queue-consumer wiring; sibling
  package, not inside `flow` (engine) or `types` (DTOs).
- Engines `node >= 22.6`; NodeNext `.js` specifiers; `typecheck`/`lint`/
  `test` scripts (`node:test`, resolve hook per repo precedent).
- No runtime deps in v1 (provider calls via `fetch`); `RESEND_API_KEY`
  read from env at send time, never logged or fingerprinted (names only).

## Message model (`src/messages.ts`)

```ts
type Channel = 'email' | 'inapp' | 'webhook'; // 'sms' | 'push' reserved
type Priority = 'low' | 'normal' | 'high';
interface Notification {
  id: string;                 // idempotency key, uuid, always set by notify()
  channel: Channel;
  template: string;           // registry key, e.g. 'welcome'
  to: string;                 // email addr | userId | URL per channel
  variables: Record<string, unknown>;
  priority?: Priority;        // default 'normal'
  dedupeKey?: string;         // app-level dedupe window key
  scheduledAt?: string;       // ISO; absent = immediate
}
interface SendResult { id: string; queue: string; scheduled: boolean }
```

`TEMPLATE_REGISTRY: Record<string, { channel: Channel; required: string[] }>`
validates `template` + required variables at produce time (throw
`NOTIFICATION_VALIDATION` on miss — fail fast, never enqueue invalid).

## Producer API (`src/notify.ts`)

- `notify(n: Omit<Notification,'id'> & { id?: string }): Promise<SendResult>`
  fills `id` (`crypto.randomUUID()`), validates against registry,
  routes `channel → queue` (`email → queues.notificationsEmail`,
  `inapp → queues.notificationsInapp`, `webhook → queues.notificationsWebhook`),
  sends via `void/queues` typed proxy.
- `notifyMany(ns): Promise<SendResult[]>` — sequential, collects per-item
  errors (throws aggregate only if all fail).
- `QUEUE_BY_CHANNEL: Record<Channel, string>` single-sources routing.

## Consumers (`queues/*.ts` in consuming app, wired by package helpers)

`queues/notifications-email.ts`:
`defineQueue<Notification>` + `maxBatchSize 50, maxBatchTimeout 10,
maxRetries 5, retryDelay 30`. Per message: idempotency check
(`processed_notifications` lookup by `id` → ack duplicate), preferences
check (`canSend` false → ack + log `skipped`), provider send; transient
errors → `retry({delaySeconds: 30})`, permanent (validation 4xx,
unsubscribed/bounced) → ack + record failure. Final attempt
(`attempts >= maxRetries`) → write `notification_failures` row, then ack
(DLQ emulation — Void deletes exhausted messages otherwise).

`queues/notifications-inapp.ts`: `defineQueue<Notification>`, inserts
into `notifications` table (userId=`to`, read=false), acks; dedupes by `id`.

`queues/notifications-webhook.ts`: POST JSON to `to` URL with 10s timeout;
2xx → ack, 429/5xx → retry, 4xx → ack + failure row.

Shared `src/consumer.ts`: `classifyError(e): 'transient'|'permanent'`,
`isFinalAttempt(msg, maxRetries)`, `recordFailure()`, `alreadyProcessed()`.

## Provider adapters (`src/providers/*.ts`)

`interface EmailProvider { send(to, subject, html, text?): Promise<{ providerId: string }> }`.
`ResendProvider` first (fetch to Resend API, `RESEND_API_KEY`); subject/
body rendered from `src/templates.ts` (pure functions per registry key,
no template engine dep in v1). SendGrid/Postmark adapters later behind
same interface; selection via env `NOTIFICATIONS_EMAIL_PROVIDER`.

## Preferences (`src/preferences.ts`)

`canSend(userId, channel, template): Promise<boolean>` — checks
`notification_preferences` (opt-out per channel + per template).
`setPreference()`, defaults allow-all. Consumer-side enforcement (fail
closed on lookup error? No — fail open with log, preferences must not
block transactional sends; document).

## Scheduling

`scheduledAt` in future → producer writes `scheduled_notifications` row
instead of enqueueing; existing `crons/cleanup.ts` pattern extended with
a due-sweep that enqueues matured rows (second cron or same file).
Past/absent → immediate send.

## Observability

Structured log per outcome
(`notification_id, channel, template, attempt, outcome`); `ack`/`retry`
decisions logged with reason; `notification_failures` table queryable
for ops; fingerprint picks up new `queues/` files + `env.RESEND_API_KEY`
name automatically (no fingerprint changes).

## Security

- Never log `variables` values (may contain PII) — log keys only.
- `void.json` snapshot rule applies: no secrets in config; provider keys
  via env bindings only.
- Webhook SSRF guard: `to` must be https, deny localhost/metadata IPs.
- Treat inbound queue bodies as untrusted (validate at consumer too —
  producer validation is not a security boundary).

## Testing

`node:test` + resolve hook (repo precedent): registry validation cases,
error classifier matrix, consumer ack/retry/final-attempt paths with
mock provider + mock batch, idempotency double-delivery, webhook SSRF
denials, template required-variable checks. Local E2E via Miniflare auto-
invoke + `/__void/queue` manual dispatch documented in README.

## Milestones

1. Types + registry + `notify` + email consumer + Resend adapter +
   `defineQueue` migration of `apps/api/queues/email.ts`; widen
   `EmailQueuePayload.variables` consumer to new envelope.
2. Preferences/opt-out + in-app channel + `notifications`,
   `notification_preferences`, `notification_failures` tables (db
   migration) + DLQ-emulation paths.
3. Flow dispatcher typed as `(queueName, Notification)` routed through
   `notify`; webhook channel; README + local-dev guide.

## Open decisions

- Resend as first provider (repo already names it in a comment)?
- In-app store: D1 table (needs migration) vs KV?
- Scheduled sweep: extend `crons/cleanup.ts` or separate cron file?
