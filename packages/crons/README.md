# `@void-monorepo/crons`

Scanner, manifest, local trigger, activity log, and glossy dev panel for Void `crons/`.

## Void contract

Each file in `crons/**/*.ts` (`.mts`, `.js`, `.mjs` also supported) must export:

- `export const cron = "<expression>"` (or an array of expressions — 5-field cron)
- a default handler (recommended: wrapped with `defineScheduled`)

Files/dirs starting with `_` are ignored. Jobs sharing one expression each run once per
invocation and count once toward the 100-expression platform limit (1000 schedules max).

## CLI

```bash
pnpm --filter @void-monorepo/crons build
node packages/crons/bin/void-crons.mjs list apps/api
node packages/crons/bin/void-crons.mjs check apps/api   # exit 1 on invalid jobs / limit overflow
node packages/crons/bin/void-crons.mjs emit apps/api    # writes apps/api/void.crons.json
node packages/crons/bin/void-crons.mjs trigger heartbeat --origin http://localhost:5173 --token <dev-token>
```

`trigger` POSTs `{ cron, scheduledTime }` to `/__void/scheduled` with
`x-void-dev-trigger` (local) or `x-void-internal` from `--token` / `CRON_SECRET` (prod).
Schedules never fire automatically in local dev — the panel/CLI fire them on demand.

## Panel

One component serves both surfaces — in-app page and dev overlay — via props:

```tsx
import { CronPanel } from '@void-monorepo/crons/ui';
import { scanCronFiles } from '@void-monorepo/crons';

<CronPanel
  jobs={scanCronFiles(appRoot)}
  activity={store.list()}
  onToggle={(name, disabled) => store.setDisabled(name, disabled)}
  onTrigger={(job) => triggerJob(job, { origin, devToken })}
/>
```

Toggle semantics: **Off skips local triggers and hides the job from `void.crons.json`**.
It is not a prod kill-switch — Cloudflare triggers can't be disabled at runtime.

## API

| export | purpose |
|---|---|
| `scanCronFiles(appRoot, { disabled })` | parse `crons/`, flag shared/missing/invalid |
| `buildCronManifest` / `emitCronManifest` | `void.crons.json` with expr/schedule counts |
| `triggerExpression` / `triggerJob` | fire via `/__void/scheduled` |
| `createCronStore` | in-memory activity + toggles (swap for KV/Drizzle in prod) |
| `appendActivityLog` / `readActivityLog` | shared `void.crons.activity.json` history |
| `CronPanel` (`./ui`) | glossy job list + activity feed |
