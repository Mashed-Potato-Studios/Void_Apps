# Monorepo app and resource inventory

Type: task
Status: resolved
Blocked by:

## Question

Walk this repo and record the ground truth the schema decision needs — no decisions, just facts. For each of `apps/web`, `apps/api`, `apps/admin`: `void.json` contents, `vite.config.ts` plugins, presence/shape of `routes/,pages/,middleware/,db/,crons/,queues/,durable-objects/,email/,src/,public/`, framework adapter, target, auth providers, routing headers/revalidate. For `packages/`: role of `flow,db,auth,ui,api-client,types,config` and which apps consume them; DB schema location (`packages/db/src/schema/`) and migration flow; Turbo pipeline (`turbo.json`) and deploy workflow (`.github/workflows/deploy.yml`). Output a compact inventory table the schema ticket can build on.

## Comments

## Answer

Resolved 2026-10-13 (GitHub #4, closed). Full inventory in issue Answer: per-app dirs/void.json/deps (web React+auth-mw+health; api headless+queues+crons+workflows/ outlier; admin pages+stats sans mw); absences (no src/durable-objects/db/email/void.config/.void, zero live void imports); package roles + consumer matrix (db touches all); pipeline (turbo+CI); gaps (no lockfile/migrations/node_modules). Inputs to #5: workflows/ include rule, schema+migration hash inputs, lockfile policy.
