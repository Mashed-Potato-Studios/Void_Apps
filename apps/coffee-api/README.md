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
```

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
