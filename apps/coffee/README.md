# Crew Coffee — café storefront

The customer-facing café. A Void-native React Pages app that renders the live
menu and sends checkouts to the coffee API. No database, no crons, no admin
surface lives here.

| Route | What it does |
|---|---|
| `/` | Illustrated menu, live stock, cart, checkout confirmation |
| `POST /api/checkout` | Same-origin proxy to `POST {COFFEE_API_URL}/api/orders` |
| `GET /api/health` | Liveness plus API reachability (`api: up/down`) |

## Run locally

```bash
pnpm --filter @void-monorepo/coffee-api dev    # http://localhost:5175
pnpm --filter @void-monorepo/coffee dev        # http://localhost:5173
pnpm --filter @void-monorepo/coffee-admin dev  # http://localhost:5174
```

Environment values are required and server-side. The local `.env` uses the
ports above:

```ini
COFFEE_API_URL=http://localhost:5175
COFFEE_ADMIN_URL=http://localhost:5174
```

For production, set them with `void secret put COFFEE_API_URL` /
`void secret put COFFEE_ADMIN_URL` before `void deploy`.

## Boundaries

- Menu, stock, prices, and order creation belong to
  [`apps/coffee-api`](../../apps/coffee-api/README.md).
- Dashboard, inventory editing, order history, and the cron console belong to
  [`apps/coffee-admin`](../../apps/coffee-admin/README.md).
- Shared wire types and the typed HTTP client live in
  [`packages/coffee-contract`](../../packages/coffee-contract/src/index.ts).
- The visual language (photos, recipes, CSS) lives in
  [`packages/coffee-theme`](../../packages/coffee-theme/src/index.ts).

The browser only talks to this origin. The checkout proxy attaches the API
origin server-side, so there is no CORS dependency and the admin bearer token
never leaves the server.
