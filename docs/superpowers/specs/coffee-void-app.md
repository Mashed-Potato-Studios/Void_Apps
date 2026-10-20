# Coffee — Void Quickstart Demo App

Status: approved design → spec
Owner: Vantol

## Why

A real, everyday-use app that exercises every CLI and package surface this repo owns: the Void Quickstart path itself (`void init`, typed fetch, D1, crons, deploy), the workspace packages (`types`, `auth`, `db`, `ui`, `crons`), and our homegrown tooling (`void-crons`, `void-fingerprint`, CronPanel). React template, ShadCN + ReactBits styling, mock purchase flow, Cloudflare deploy target.

Stack call worth recording: `void@1.1.11` is now on npm as the real SDK ("Full-stack framework and deployment CLI for Cloudflare Workers, powered by Vite"). Coffee is the first app in this repo to use the real `voidPlugin()` — apps/api/web/admin still run the defensive shim against the unrelated `void@^0.1.0` package.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Location | `apps/coffee` in the monorepo | Workspace imports (`workspace:*`), shared pnpm installs, `void-crons` scans it out of the box |
| Scaffold | Quickstart-native | Exercises the real vendor path — the whole point |
| Void SDK | `void@^1.1.11`, real `voidPlugin()` in vite.config.ts | First true integration; no defensive shim |
| Payments | Mock checkout (D1 order, marked paid) | Demo, not production commerce |
| Deploy | Cloudflare target chosen during init; `void deploy` runs during acceptance | End-to-end Quickstart |
| Panel | Coffee imports `CronPanel` from `@void-monorepo/crons` | Dogfoods the published export shape (`@void-monorepo/crons/ui`) |
| Pricing | USD cents, integer price_cents | Smallest unit, no float math |

## Structure

```
apps/coffee/
  void.json                  # cloudflare target, auth providers (email+github+google parity w/ apps/web), api/* CORS headers, compatibility_date 2026-01-01, nodejs_compat
  vite.config.ts             # real voidPlugin() from void@^1.1 — no createRequire fallback
  tsconfig.json
  void.d.ts                  # from the real SDK's types (accept CLI's canonical shape)
  db/
    schema.ts                # menu_items, orders, order_items (Drizzle)
    seed.ts                  # 8 coffees: name, origin (single/blend), price_cents, stock
  pages/
    index.tsx                # storefront: hero + menu grid (ShadCN Card/Button/Badge, ReactBits-style ambiance)
    index.server.ts          # loader: menu from D1
    coffee/[id].tsx          # detail + add-to-cart
    coffee/[id].server.ts
    checkout.tsx             # mock purchase action → order rows → confirmation view
    checkout.server.ts
    dashboard.tsx            # recent orders, revenue total, low-stock alerts, Today's Favorite (from top-coffee cron)
    dashboard.server.ts
    admin/crons.tsx          # CronPanel via @void-monorepo/crons/ui backed by createCronStore
  routes/api/
    menu.ts                  # GET menu
    orders.ts                # GET (dashboard aggregate) / POST (create mock order)
    health.ts                # GET liveness
  crons/
    rollover.ts              # 0 3 * * * — restock menu items to default levels
    top-coffee.ts            # 15 * * * * — recompute Today's Favorite from order_items
```

Workspace deps: `@void-monorepo/types`, `@void-monorepo/auth` (RBAC utils for dashboard loader), `@void-monorepo/ui` (Header/Card/Button where fitting), `@void-monorepo/crons`. Each import is used somewhere concrete; nothing speculatively referenced.

Scripts (parity with apps/api + curl-able triggers):
`void:deploy`, `crons:list/check/emit/trigger`, `fp:emit/fp:check`, plus `crons:schedule` launching the `void-crons schedule` live loop against `http://localhost:5173` during dev so both jobs fire through the real endpoint.

## Data model (Drizzle, app-local)

- `menu_items`: id, slug (unique), name, origin, price_cents, stock, default_stock, is_active
- `orders`: id, total_cents, status (`paid` for all — mock), created_at
- `order_items`: id, order_id→orders, menu_item_id→menu_items, qty, price_cents
- `coffee_stats`: id, top_menu_item_id→menu_items, computed_at (single row, rewritten by top-coffee)
- Low-stock threshold = stock < 5 → dashboard alert card

## Cron contract

Both files: `export const cron = '...'` + `defineScheduled`-wrapped default handler (matches `void-crons` scan + cloudflare 5-field validation). `top-coffee` writes "Today's Favorite" into a dedicated 1-row `coffee_stats` table next to orders (D1 already in play; KV adds a second resource for no gain). Rollover increments stock up to default_stock (never exceeds), leaves orders untouched. Handlers catch + log D1 failures and rethrow so the scheduler records status=failed in the activity log.

## Verification (acceptance sweep)

1. `void init` completes with real plugin; `void dev` boots; vite.config has no shim or warnings
2. Storefront renders 8 menu items via typed fetch of `/api/menu`
3. Checkout: page action → orders + order_items rows → confirmation shows order id; dashboard reflects it
4. `node packages/crons/bin/void-crons.mjs list apps/coffee` shows 2 jobs; `check` clean; `emit` writes manifest; admin/crons page renders activity (seed one failed entry via `trigger` against a dead origin)
5. `void deploy` succeeds to Cloudflare with the user's account; deployed URL serves storefront + dashboard
6. `turbo run build --filter=@void-monorepo/coffee` green; `void-fingerprint check` parity green

## Risks

- `void.json`/`void.d.ts` keys were written against the shim; the real CLI may reject or rewrite them. Accept the CLI's canonical output if it rewrites. Flag to platform if new keys are required.
- Real `voidPlugin()` behavior with the repo's Vite version is unknown until init runs — if the CLI pins a Vite+ version, coffee locally gets its own (confined to the app's node_modules), not repo-wide.
- Deployment needs interactive Cloudflare sign-in — stop and hand to user when the browser step appears.
- Dev origin for cron triggers depends on the real plugin exposing `/__void/scheduled`; if it doesn't in v1.1.x, fall back to the known-good raw-expression path via `void-crons trigger '<cron expr>'` against port 5173.
