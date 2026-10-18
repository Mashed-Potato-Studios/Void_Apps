# `@void-monorepo/crons`

Cron lifecycle for Void `crons/` — scan, preview, manifest, drift check, catch-up, live scheduler, activity log, and glossy dev panel. One CLI (`void-crons`), one library, one React component.

## Void contract

Each file in `crons/**/*.ts` (`.mts`, `.js`, `.mjs` also supported) must export:

- `export const cron = "<5-field cron expression>"` — or an array of expressions
- a default handler (recommended: wrapped with `defineScheduled`)

Files/dirs starting with `_` are ignored. Jobs sharing one expression each run once per
invocation and count once toward the 100-expression platform limit (1000 schedules max).

## Quick start

```bash
node packages/crons/bin/void-crons.mjs list apps/api
# apps/api: 1 job(s)
#   ● cleanup  0 2 * * *  next in 3h

node packages/crons/bin/void-crons.mjs check apps/api
# apps/api: clean (1 jobs, 1 expr, 1 sched)

node packages/crons/bin/void-crons.mjs emit apps/api
# emitted apps/api/void.crons.json

node packages/crons/bin/void-crons.mjs schedule apps/api --once
# apps/api: fired cleanup 0 2 * * * (128ms)
# apps/api: caught up (1 fired, 0 skipped)

node packages/crons/bin/void-crons.mjs schedule apps/api
# scheduled 1 expression · origin http://localhost:5173 · next 0 2 * * * in 3h
# (live loop — fires each expression as its minute passes; Ctrl-C exits 0)

node packages/crons/bin/void-crons.mjs trigger cleanup --origin http://localhost:5173 --token <dev-token>
# apps/api: fired cleanup 0 2 * * * (95ms)
```

Out of range or disabled:

```bash
node packages/crons/bin/void-crons.mjs schedule apps/api --once     # disabled job
# apps/api: skip job "cleanup" is disabled
# apps/api: caught up (0 fired, 1 skipped)
```

## CLI reference

Works per-app (`[app-path]`, default cwd) or `--all` across `apps/*` (needs `void.json`).

| Command | What it does | Exit 1 |
|---|---|---|
| `list [app]` | scanned jobs + `next in Xm` preview + activity tail; `--json` carries `nextFireMs` | invalid job present |
| `check [app]` | invalid jobs + platform limits + **manifest drift** (default on; `--no-drift` skips) | invalid jobs, limit overflow, drift |
| `emit [app]` | writes `void.crons.json` (reviewed diffs, CI baseline, deploy artifact) | — (2 on tool error) |
| `schedule [app] --once` | fires most-recent due per expression within trailing 24h, appends activity log | — |
| `schedule [app]` | live loop: 30s ticks, fires each expression at most once per matched minute, appends activity log | — |
| `trigger <job\|expr>` | manual fire via `/__void/scheduled`; `--cron EXPR` overrides, `--token` dev header | HTTP failure |

Exit codes: `0` clean · `1` drift/invalid/failed · `2` tool/usage error.

`--json`: machine-readable, every object carries `format: 1`. `check --json` prints
`{app, ok, format, problems, drift}` when problems exist and `{app, ok, format, jobs,
expressions, schedules}` when clean; `schedule --once --json` prints
`{format, app, fired: CronActivityEntry[], skipped: [{cron, jobName, reason}]}`;
`list --json` adds `nextFireMs` per active job.

## Drift detection

`check` compares the committed `void.crons.json` against a fresh scan — active job
paths and expression **sets** only (never `emittedAt`). Human output:

```text
apps/api: invalid
  ✕ -crons/heartbeat.ts removed
  ✕ ~crons/cleanup.ts cron '0 2 * * *, 30 * * * *' → '0 3 * * *'
  run void-crons emit to regenerate
```

Emitted manifests are committed at app roots — reviewable diffs, CI baseline, deploy artifact.

## Activity log

`scheduler`/`--once`/`trigger` append to `void.crons.activity.json` (capped at 100
entries, newest first) so the CLI and CronPanel share history. Swap `createCronStore`
for KV/Drizzle in prod — the panel only needs `record/list/setDisabled`.

## Panel

One component serves the in-app page and the dev overlay:

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

## Known limits

- Cron validation is **shape-only** (5 fields of `* , - / digits`) — semantic garbage
  like `99 99 99 99 99` passes here and would fail at Cloudflare.
- The real Void SDK is not on this repo's lockfile yet; `defineScheduled` detection is
  regex-level, and dev/build run without the plugin (see apps/api/vite.config.ts).
- No timezone support — expressions parse in server-local time.
- Activity log races (CLI and panel writing concurrently) are last-writer-wins —
  dev artifact only; prod must use the swapped store.
