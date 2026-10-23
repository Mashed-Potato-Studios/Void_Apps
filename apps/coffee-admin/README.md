# Coffee Admin

The back office for Crew Coffee. Server-rendered React Pages app behind HTTP
Basic Auth; reads the coffee API with a server-side bearer token and proxies
admin mutations through this app's own origin.

| Route | What it shows |
|---|---|
| `/` | Today's revenue, all-time revenue, top drink, low stock |
| `/orders` | Latest 100 orders with line items and totals |
| `/menu` | Editable price, stock, restock level, and visibility |
| `/crons` | Job registry, D1 run history, "Run now" trigger |

`/api/admin/*` is a BFF proxy. The browser never sees
`COFFEE_ADMIN_TOKEN`: the proxy attaches it, and the global Basic Auth
middleware gates every page, loader, action, and proxy call.

## Local setup

```bash
cat > .env <<'EOF'
COFFEE_API_URL=http://localhost:5175
COFFEE_SITE_URL=http://localhost:5173
COFFEE_ADMIN_TOKEN=crew-coffee-dev-admin-token
ADMIN_USERNAME=barista
ADMIN_PASSWORD=crew-coffee
EOF
pnpm --filter @void-monorepo/coffee-admin dev   # http://localhost:5174
```

All five keys are required. Sign in as `barista` / `crew-coffee`.
`COFFEE_ADMIN_TOKEN` must match the API.

## Production

```bash
void secret put COFFEE_API_URL
void secret put COFFEE_SITE_URL
void secret put COFFEE_ADMIN_TOKEN
void secret put ADMIN_USERNAME
void secret put ADMIN_PASSWORD
void deploy
```

Basic Auth is a deliberate, boring gate for an internal tool. If the admin
needs per-user roles later, replace `middleware/01-basic-auth.ts` with the
repo's auth package and keep the BFF token boundary.
