# Crew Coffee

Coffee-lovers storefront + admin dashboard — the first app in this repo on the
real Void SDK (`void@^1.1.11`, real `voidPlugin()`), built via the Void
Quickstart path (React + D1 + Cloudflare). Exercises the whole toolchain:
typed fetch, D1 + Drizzle, four cron jobs, schedule admin page, `void-crons`
and `void-fingerprint` CLIs.

## Run locally

```bash
pnpm --filter @void-monorepo/coffee dev   # http://localhost:5173
```

| Route | What it shows | Backed by |
|---|---|---|
| `/` | Storefront hero + 10-coffee menu grid, cart + mock checkout | `GET /api/menu` (seed), `POST /api/orders` |
| `/dashboard` | Today's Favorite, revenue, low-stock alerts, recent orders | `GET /api/orders` aggregate |
| `/admin/crons` | Roastery schedule: 4 jobs, expression/schedule counts, activity | `void.crons.json` + `void-crons` store |
| `GET /api/health` | Liveness `{ status, app, timestamp }` | — |
| `GET /api/menu` | 10 coffees `{ success, data }` | `db/seed.ts` |
| `GET /api/orders` | `{ orders, revenueCents, lowStock }` | live D1 w/ seed fallback |
| `POST /api/orders` | Creates order + items, returns `{ id, totalCents }` | live D1 |

## The crons

- `0 3 * * *` **rollover** (`crons/rollover.ts`) — restocks every active menu
  item up to `default_stock`. Never exceeds default, never touches orders.
- `15 * * * *` **top-coffee** (`crons/top-coffee.ts`) — group-by over
  `order_items`, rewrites the 1-row `coffee_stats.current` ("Today's Favorite").
- `30 7 * * *` **stock-alert** (`crons/stock-alert.ts`) — morning low-stock
  digest, logs every active item under 5 units before opening.
- `0 18 * * 5` **sales-digest** (`crons/sales-digest.ts`) — Friday 18:00
  week-in-review, counts orders and sums revenue.

Observe locally:

```bash
pnpm --filter @void-monorepo/coffee crons:list      # 4 jobs + next-fire
pnpm --filter @void-monorepo/coffee crons:check     # manifest drift gate
pnpm --filter @void-monorepo/coffee crons:schedule  # live loop vs dev origin (Ctrl-C exits 0)
```

Manual fire (dev token printed at `pnpm dev` boot):

```bash
curl -X POST http://localhost:5173/__void/scheduled \
  -H "x-void-dev-trigger: <token>" -H 'content-type: application/json' \
  -d '{"cron":"0 3 * * *","scheduledTime":'$(date +%s000)'}'
```

## Mock checkout semantics

- `POST /api/orders` with empty/missing `items` → `400 EMPTY_CART`
- Unknown `slug` → `400 UNKNOWN_ITEM`; non-positive-integer `qty` → `400 BAD_QTY`
- Page layer disables sold-out items; the API intentionally doesn't double-check
  stock (mock scope, per spec)
- `503 DB_UNAVAILABLE` is the expected local surface before D1 migrations are
  applied (`void db migrate`); after that, checkout returns `200 { id, totalCents }`

## Verification checklist

- [ ] `pnpm dev` boots with real `voidPlugin()` (no `void-missing`, no shim)
- [ ] Storefront renders 10 menu items via `GET /api/menu`
- [ ] Checkout: `POST /api/orders` 200 → confirmation shows order id → dashboard reflects it
- [ ] `void-crons list/check/emit` clean against `apps/coffee`; admin/crons renders
- [ ] `void deploy` succeeds; deployed URL serves storefront + dashboard
- [ ] `turbo run typecheck/build --filter=@void-monorepo/coffee` green + `fp:check` green

## Known limits

- Local D1 may be unprovisioned until `void db migrate` runs — `503
  DB_UNAVAILABLE` on POST and empty-state dashboard are the expected degraded
  surface, not a bug
- `void.config.ts` is canonical (owned by the `void init` CLI) — don't hand-edit
  keys the CLI manages; `void.json` keys from the shim apps don't apply here
