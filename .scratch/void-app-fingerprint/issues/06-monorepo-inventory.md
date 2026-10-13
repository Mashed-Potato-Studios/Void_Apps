# Monorepo app and resource inventory

Type: task
Status: open
Blocked by:

## Question

Walk this repo and record the ground truth the schema decision needs — no decisions, just facts. For each of `apps/web`, `apps/api`, `apps/admin`: `void.json` contents, `vite.config.ts` plugins, presence/shape of `routes/,pages/,middleware/,db/,crons/,queues/,durable-objects/,email/,src/,public/`, framework adapter, target, auth providers, routing headers/revalidate. For `packages/`: role of `flow,db,auth,ui,api-client,types,config` and which apps consume them; DB schema location (`packages/db/src/schema/`) and migration flow; Turbo pipeline (`turbo.json`) and deploy workflow (`.github/workflows/deploy.yml`). Output a compact inventory table the schema ticket can build on.

## Comments
