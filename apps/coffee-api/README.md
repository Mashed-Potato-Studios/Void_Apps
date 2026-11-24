# Coffee API

D1-backed backend for Crew Coffee. Owns the menu, inventory, orders, sales
aggregates, and the four scheduled jobs. The café and admin apps are HTTP
clients of this service.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/health` | public | Liveness |
| `GET /api/menu` | public | Active menu items, sorted by name |
| `POST /api/orders` | public | Checkout; conditional stock decrement, `409 SOLD_OUT` |
| `GET /api/admin/overview` | bearer | Revenue, today's revenue, top drink, low stock |
| `GET /api/admin/orders` | bearer | Recent orders with line items (`?limit=1..200`) |
| `GET /api/admin/menu` | bearer | Full inventory, including hidden drinks |
| `PATCH /api/admin/menu/:id` | bearer | Price, stock, restock level, visibility |
| `GET /api/admin/crons` | bearer | Job registry + last 50 legacy D1 runs |
| `GET /api/admin/crons/ledger` | bearer | New `void-crons/d1` ledger events (`?limit=1..200`) |
| `POST /api/admin/crons/:name/run` | bearer | Run a job now, recorded as `manual` |
| `POST /api/admin/queues` | bearer | Enqueue an `order-events` message via the typed `void/queues` proxy |

Every response uses `{ success, data }` or `{ success, error: { code, message } }`.
Admin routes require `Authorization: Bearer $COFFEE_ADMIN_TOKEN`.

## Data model

`db/schema.ts` defines `menu_items`, `orders`, `order_items`, `coffee_stats`,
and `cron_runs`. `cron_runs` is the legacy scheduler history written by
`executeJob()` (kept for 30 days). `cron_ledger` is the newer
`void-crons/d1` ledger used by the staging-safe heartbeat. It is created by
`ensureSchema()` on first use and kept separate so both schemas can coexist
during migration.

Checkout decrements stock with a conditional update
(`stock = stock - qty WHERE stock >= qty`) and restores any prior decrements
if a later line or the order insert fails. Concurrent checkouts cannot drive
inventory negative.

## Jobs

| Job | Cron | What it does |
|---|---|---|
| `coffee-nightly-restock` | `0 3 * * *` | Restock active drinks up to `default_stock` |
| `coffee-top-coffee` | `15 * * * *` | Recompute `coffee_stats.current` from today's order items |
| `coffee-stock-alert` | `30 7 * * *` | Log active drinks under five units |
| `coffee-sales-digest` | `0 18 * * 5` | Friday week-in-review log |
| `coffee-staging-heartbeat` | `0 4 * * *` | Safe ledger smoke test; logs and writes one ledger row |

Job logic lives in `src/jobs/*`; the files in `crons/` are thin
`defineScheduled` wrappers. The admin console's "Run now" calls the same
`executeJob()` path, so manual and scheduled runs behave identically. Cron
expressions in `crons/*.ts` must stay string literals (Void requirement); the
registry's copy is what the admin displays.

## Queues

`queues/order-events.ts` is a `defineQueue<OrderEvent>` consumer named
`order-events` by its path. It accepts order lifecycle events (`created` /
`restocked`), logs each delivery, and calls `message.ack()`; a bad body is
retried with a 10s delay. Batch size 25, timeout 5s, 3 retries, retry delay 10s.
Ack/retry policy and idempotency are app-owned — retried deliveries can run
more than once.

Two ways to produce a message locally:

```bash
# Typed proxy (auth required; native Void dev invokes the consumer automatically)
curl -X POST http://localhost:5175/api/admin/queues \
  -H "Authorization: Bearer crew-coffee-dev-admin-token" \
  -H 'content-type: application/json' \
  -d '{"orderId":"demo-1","type":"created","itemCount":2,"totalCents":1250}'

# void-crons dev endpoint (works in framework adapters too).
# Requires the dev server to be running and its printed trigger token.
VOID_DEV_TRIGGER=<token-from-boot-log> pnpm --filter @void-monorepo/coffee-api queues:send
```

The dev server prints a paste-ready `POST /__void/queue` curl command with the
current token at boot (`[void] Detected 5 crons and 1 queue`). `queue-send` reads
`$VOID_DEV_TRIGGER` automatically, or pass `--token <token>`. Without a running
server you get `HTTP 0` / `transport failed`; without a valid token you get
`HTTP 401`. The UUID after `-H "x-void-dev-trigger: …"` in the printed curl is
the actual token (not a placeholder). In this app it has been stable across
dev boots; regenerate it if the dev server reports a different one.

Inspect the queue with the new `void-crons` scanner:

```bash
pnpm --filter @void-monorepo/coffee-api queues:list
pnpm --filter @void-monorepo/coffee-api exec void-crons queues --json
```

The queue also appears inside the cron dashboard: run `pnpm exec void-crons ui`
from this directory (a globally installed `void-crons` may be an older build),
press `Q` to swap the lower pane to queues, and `↵` to send a demo message.
Start `pnpm dev` first and pass the token it prints via `--token` or
`VOID_DEV_TRIGGER`; otherwise triggers fail with 401. The TUI shows a
`no dev token` hint until one is configured.

The generated `.void/queues.d.ts` is fed to the `void/queues` proxy by
`src/void-queues.d.ts` (void 1.1.11 does not augment the module itself). `void build`
regenerates the queue types after adding or renaming a consumer.

## Local setup

```bash
printf 'COFFEE_ADMIN_TOKEN=crew-coffee-dev-admin-token\n' > .env
pnpm --filter @void-monorepo/coffee-api exec void db migrate
pnpm --filter @void-monorepo/coffee-api exec void db seed
pnpm --filter @void-monorepo/coffee-api dev   # http://localhost:5175
```

Seed data intentionally includes low stock (Espresso 0, Pour Over 2,
Macchiato 4) so the admin overview has something to show.

Inspect the scheduler:

```bash
pnpm --filter @void-monorepo/coffee-api crons:list
pnpm --filter @void-monorepo/coffee-api crons:check
pnpm --filter @void-monorepo/coffee-api crons:emit
pnpm --filter @void-monorepo/coffee-api crons:ui   # TUI with the correct port (5175)
```

`crons:ui` passes `--origin http://localhost:5175`. Launching `void-crons ui`
without it uses the generic default `localhost:5173`, so every trigger fails
with a transport error.

Trigger a job locally with the token printed at boot:

```bash
curl -X POST http://localhost:5175/__void/scheduled \
  -H "x-void-dev-trigger: <token>" -H 'content-type: application/json' \
  -d '{"cron":"15 * * * *","scheduledTime":'"$(date +%s000)'"}'
```

## Testing the new cron ledger

The staging-safe heartbeat exercises `instrumentScheduled` plus the
`void-crons/d1` adapter without changing inventory or orders.

```bash
pnpm --filter @void-monorepo/coffee-api test
pnpm --filter @void-monorepo/coffee-api dev
pnpm --filter @void-monorepo/coffee-api crons:emit

# after the dev token is printed:
pnpm --filter @void-monorepo/coffee-api exec void-crons trigger staging-heartbeat \
  --origin http://localhost:5175 --token <dev-token>

curl -s http://localhost:5175/api/admin/crons/ledger \
  -H "Authorization: Bearer crew-coffee-dev-admin-token" | jq
```

The integration test uses a fake D1 binding and asserts the heartbeat writes one
`handler` event, the query APIs return it, and a duplicate scheduled delivery is
deduped by idempotency key.

For deployed verification, trigger the same safe job:

```bash
CRON_SECRET=... pnpm --filter @void-monorepo/coffee-api exec void-crons verify \
  --origin https://staging.example.com --transport framework \
  --cron "0 4 * * *" --evidence void.crons.production.json \
  --allow-remote --confirm-remote-write
```

## Production

```bash
void secret put COFFEE_ADMIN_TOKEN
void secret put COFFEE_ALLOWED_ORIGINS   # comma-separated café/admin origins
void deploy
```

`COFFEE_ALLOWED_ORIGINS` defaults to the two localhost origins; set it to the
deployed café and admin origins. Admin routes are bearer-gated regardless of
CORS.
