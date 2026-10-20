# `void-crons`

![version](https://img.shields.io/badge/version-0.3.0-blue)
![node](https://img.shields.io/badge/node-%3E%3D22.6-339933?logo=node.js&logoColor=white)
![type](https://img.shields.io/badge/module-ESM-yellow)
![license](https://img.shields.io/badge/license-MIT-green)
![tests](https://img.shields.io/badge/tests-85_passed-brightgreen)
![cron-parser](https://img.shields.io/badge/cron--parser-v5-orange)
![react](https://img.shields.io/badge/react-18_%7C_19_optional-61dafb)
![platform](https://img.shields.io/badge/platform-cloudflare-F38020?logo=cloudflare&logoColor=white)
![npm](https://img.shields.io/badge/npm-void--crons-CB3837?logo=npm&logoColor=white)

> **For apps built on [Void Cloud](https://void.cloud/)** — the Vite-based framework
> for deploying to Cloudflare. If your app doesn't have a `void.json` and a `crons/`
> directory, this package isn't for you.

Local lifecycle for Void `crons/` — scan, validate, preview, manifest, drift-check,
catch-up, live scheduling, retries, activity history, and an interactive terminal
UI with a live loop, filtering, and job detail. One CLI (`void-crons`), one
library, one React panel.

New to Void? Start at [void.cloud](https://void.cloud/) — particularly the
[jobs guide](https://void.cloud/guide/jobs), which defines the `crons/` contract
this package implements locally.

```bash
npm i -g void-crons
cd path/to/your-app                             # the app dir: void.json + crons/
void-crons check && void-crons emit             # CI gate + deploy artifact
void-crons schedule --once                      # catch-up missed fires
void-crons trigger cleanup                      # fire one job right now
void-crons ui                                   # interactive dashboard
```

## Contents

- [The Void contract](#the-void-contract)
- [Quick start](#quick-start)
- [CLI reference](#cli-reference)
- [TUI](#tui)
- [Job files in depth](#job-files-in-depth)
- [Validation](#validation)
- [Timezones](#timezones)
- [Delivery: retries, timeouts, exit codes](#delivery-retries-timeouts-exit-codes)
- [Manifest & drift](#manifest--drift)
- [Activity history](#activity-history)
- [Library API](#library-api)
- [React panel](#react-panel)
- [The `void` module note](#the-void-module-note)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)

## The Void contract

Each file in `crons/**/*.ts` (`.mts`, `.js`, `.mjs` also accepted) must export:

```ts
// crons/cleanup.ts
import { defineScheduled } from "void";

export const cron = "0 2 * * *"; // or ["0 2 * * *", "30 * * * *"]

export default defineScheduled(async ({ cron, scheduledTime }) => {
  // ... do the work ...
  return { purged: 4 };
});
```

- `export const cron` — one 5-field expression, or an array of them.
- A default handler — receives `{ cron, scheduledTime }`, wrapped in
  `defineScheduled` (recommended; feeds the `usesDefineScheduled` badge).
  Contract source of truth: [void.cloud/guide/jobs](https://void.cloud/guide/jobs).
- Files or directories starting with `_` are ignored entirely.
- Jobs sharing one expression fire once per invocation and count once toward
  the 100-expression platform limit (1000 schedules max).

```
crons/
  cleanup.ts      # 0 2 * * *      nightly purge
  heartbeat.ts    # * * * * *      every minute
  reports.ts      # */15 * * * * + 30 9 * * 1
  _draft.ts       # ignored (leading underscore)
```

## Quick start

Every command takes an optional app path — the directory containing `void.json`
and `crons/`. **Omit it to use the current directory.** The examples below run
from inside the app directory:

```bash
cd path/to/your-app

# 1. See what the scanner finds (previews use server-local time by default)
void-crons list
# your-app: 3 job(s)
#   ● cleanup    0 2 * * *  next in 18h
#   ● heartbeat  * * * * *  next in <2m
#   ● reports    */15 * * * *, 30 9 * * 1  next in 6m

# 2. Gate on it, then freeze the deploy artifact
void-crons check
# your-app: clean (3 jobs, 4 expr, 4 sched)
void-crons emit
# emitted path/to/your-app/void.crons.json

# 3. Fire what's due (catch-up for the trailing 24h)
void-crons schedule --once --origin http://localhost:5173
# your-app: fired cleanup 0 2 * * * (24ms)
# your-app: caught up (1 fired, 0 skipped)

# 4. Fire one job on demand
void-crons trigger cleanup --origin http://localhost:5173
# your-app: fired cleanup 0 2 * * * (95ms)

# 5. Live loop — fires each expression as its minute passes (Ctrl-C exits 0)
void-crons schedule --origin http://localhost:5173
# scheduled 4 expressions · origin http://localhost:5173 · next */15 * * * * in 6m
```

Disabled-job flow:

```bash
void-crons schedule --once
# your-app: skip job "cleanup" is disabled
# your-app: caught up (0 fired, 1 skipped)
```

## CLI reference

Runs per-app. `[app-path]` is the directory containing `void.json` and
`crons/`; omit it to use cwd. `--all` scans `apps/*` (each needs `void.json`).
`trigger` is the one exception: the job selector comes first, then the optional
app path (`void-crons trigger cleanup path/to/your-app`).

| Command | What it does | Non-zero exit |
|---|---|---|
| `list [app-path] [--tz Z]` | Scanned jobs, `next in Xm` previews, activity tail. `--json` adds `nextFireMs` per active job | `1` if any job invalid |
| `ui [app-path] [--tz Z] [--store MODE] [--origin URL]` | Interactive TUI: jobs, countdowns, drift, activity; trigger/toggle/emit/catch-up | `2` if not a TTY or `--json`/`--all` used |
| `check [app-path]` | Invalid jobs, platform limits, manifest drift (skip drift with `--no-drift`) | `1` problems/drift · `2` tool error |
| `emit [app-path]` | Writes `void.crons.json` | `2` on tool error |
| `schedule [app-path] --once [--tz Z] [--retries N]` | Fires the most-recent due per expression in the trailing 24h | `1` on fire failures |
| `schedule [app-path] [--tz Z] [--retries N]` | Live loop: 30s ticks, each expression fires at most once per matched minute | `2` on bad flags |
| `trigger <job\|expr> [app-path] [--retries N]` | Manual fire via `POST /__void/scheduled`. `--cron EXPR` overrides the job's expression | `1` HTTP/unknown job · `2` usage |

Exit codes: `0` clean · `1` drift / invalid / failed fire · `2` tool, usage, or flag error
(includes unknown `--tz` / `--store`).

| Flag | Default | Meaning |
|---|---|---|
| `--origin URL` | `http://localhost:5173` | Dev server receiving `POST /__void/scheduled` |
| `--cron EXPR` | job's own | Fire a different expression under the job's name |
| `--token T` | `$VOID_DEV_TRIGGER` | Sent as `x-void-dev-trigger` |
| `--tz ZONE` | server-local | IANA zone (`America/New_York`) for previews + schedule windows |
| `--retries N` | `0` | Retry 429 / 5xx / network failures; 500ms doubling backoff. 4xx never retry |
| `--timeout MS` | `10000` | Per-attempt HTTP timeout (abort) |
| `--store MODE` | `sqlite` | `sqlite` (WAL) or `jsonl` (legacy file) activity backend |
| `--json` | — | Machine-readable; every object carries `format: 1`, trigger results carry `attempts`/`retried` |
| `--all` | — | Run across `apps/*` (live `schedule` still needs one app; use `--all --once` for batch catch-up) |
| `--ci` | — | Quiet on success |
| `--no-drift` | — | `check` skips manifest comparison |

`--json` shapes: `check` prints `{app, ok, format, problems, drift}` with problems or
`{app, ok, format, jobs, expressions, schedules}` when clean;
`schedule --once` prints `{format, app, tz, fired, skipped}`;
`list` adds `nextFireMs` per active job plus top-level `tz`.

The binary runs `dist/` when it's newer than `src/`, otherwise executes `src/`
directly (Node type-stripping) with a stderr note — it never silently runs stale output.

## TUI

Start it **from the app directory** — the one containing `void.json` and
`crons/`. No path argument needed; it uses the current directory:

```bash
cd path/to/your-app
void-crons ui
```

Running from somewhere else? Pass the app directory as the one positional
argument. `ui` is the subcommand; `path/to/your-app` is the path to the app:

```bash
void-crons ui path/to/your-app
```

It needs a real terminal: stdin and stdout must be TTYs, otherwise it exits `2`.

One app, live in the terminal. Countdowns tick every second; manifest state and
activity refresh after every action.

```text
 void-crons · api                                         loop off · tz local · jsonl · localhost:5173
 3 jobs · 4 expr · 4 sched · sort next                                  manifest clean · scan 12:49:03
──────────────────────────────────────────────────────────────────────────────────────────────────────
 ● heartbeat        * * * * *                        next <2m       last ok 1m
 ● reports          */15 * * * *, 30 9 * * 1         next 11m       last ok 3m
>● cleanup          0 2 * * *                        next 13h       last fail 1h
 crons/cleanup.ts · active · 0 2 * * * · defineScheduled · last fail 1h
──────────────────────────────────────────────────────────────────────────────────────────────────────
 Activity
  ↳ 12:48 heartbeat * * * * * ok 18ms
  ↳ 12:45 reports */15 * * * * ok 134ms
  ↳ 11:48 cleanup 0 2 * * * fail 10000ms
  ↳ 10:48 heartbeat * * * * * ok 21ms

──────────────────────────────────────────────────────────────────────────────────────────────────────
 ↑↓ move · ↵ trigger · d toggle · e emit · c catch-up · s live · / filter · o sort · v detail · r · q
 status: ready
```

| Key | Action |
|---|---|
| `↑` / `↓`, `j` / `k` | Move selection |
| `enter` | Trigger the selected job (all its expressions) |
| `d` | Toggle enabled/disabled for this session |
| `e` | Emit `void.crons.json` — the only action that persists toggles |
| `c` | Catch up: fire each expression's most recent due time in the last 24h |
| `s` | Start/stop the live loop from now (no backfill) |
| `/` | Filter by name, path, or expression; `enter` applies, `esc` clears |
| `o` | Cycle sort: next fire → name → status |
| `v` | Toggle the job detail pane |
| `r` | Rescan jobs, manifest, drift, and activity |
| `q` / `Ctrl-C` | Quit and restore the terminal |

The live loop fires due expressions in-process and writes the same activity
entries as `void-crons schedule`; it starts stopped and never backfills. Toggles
take effect on the next tick. The TUI also watches `crons/` and
`void.crons.json` and rescans automatically; `r` remains the manual fallback.

`v` opens a detail pane with the job path, expressions, wrapper, last run, and
error. `/` filters the visible list without affecting what the live loop fires.

Toggles are session-only until `e`. `ui` is single-app and interactive:
`--json` and `--all` are rejected, and non-TTY stdin/stdout exits `2`.

## Job files in depth

Only string literals scan — by design, so deploys stay statically analyzable:

```ts
export const cron = "0 2 * * *";                       // ✅
export const cron: string = "0 2 * * *";               // ✅ typed
export const cron = ["0 2 * * *", "30 9 * * MON"];     // ✅ array (deduped)
export const cron: string[] = ["0 2 * * *"];           // ✅ typed array
export const cron = process.env.SCHED;                 // ❌ dynamic → "unsupported cron export"
export const cron = "not a cron";                      // ❌ "unsupported cron expression"
export const cron = "99 99 99 99 99";                  // ❌ "invalid cron expression … 0-59"
```

Comments are stripped before scanning, so commented-out schedules never ghost:

```ts
// export const cron = "0 * * * *";  // ignored — file reports "missing export const cron"
export const cron = "5 * * * *"; // trailing comments are fine
```

`usesDefineScheduled` detects the wrapper call — direct, aliased, or namespaced —
without flagging lookalikes:

```ts
import { defineScheduled } from "void";
export default defineScheduled(async () => {});          // ✅ true (recommended)

import { defineScheduled as ds } from "void";
export default ds(async () => {});                      // ✅ true (alias resolved)

import * as voidNs from "void";
export default voidNs.defineScheduled(async () => {});  // ✅ true (namespace)

import { defineScheduled } from "void";
export default async () => {};                         // ❌ bare import, no call
foo.defineScheduled(async () => {});                    // ❌ member of another object
const x = { defineScheduled() {} };                    // ❌ method shorthand
```

## Validation

Shape first (5 fields), then real range checks through `cron-parser` —
Cloudflare-compatible, including DOW names:

| Expression | Result |
|---|---|
| `0 2 * * *` | ✅ |
| `0 9 * * MON` | ✅ DOW names accepted |
| `99 99 99 99 99` | ❌ `invalid cron expression … got value 99 expected range 0-59` |
| `0 0 1 13 *` | ❌ month 13 out of range |
| `*/0 * * * *` | ❌ cannot repeat at every 0 |
| `0 0 29 2 *` | ⚠️ parses (leap dates exist) but fires only in leap years |

Impossible-but-parseable dates (Feb 30) never throw — they simply never come due,
so `list` shows `never` and the scheduler skips them.

## Timezones

Cron has no zone field, so the CLI interprets expressions in one zone per run:

```bash
void-crons list path/to/your-app --tz UTC
#   ● nine  0 9 * * *  next in 20h
void-crons list path/to/your-app --tz America/New_York
#   ● nine  0 9 * * *  next in 24h
void-crons list path/to/your-app --tz Pacific/Kiritimati
#   ● nine  0 9 * * *  next in 6h
```

`--tz` applies to `list` previews, `schedule --once`, and the live loop
(`scheduled … · tz America/New_York` in the banner). Unknown zones exit 2 with
the offending name echoed. `check`/`emit` are zone-independent (they compare
expression sets, never fire times).

## Delivery: retries, timeouts, exit codes

Every fire is `POST {origin}/__void/scheduled` with `{cron, scheduledTime}`.
Auth: `x-void-dev-trigger` (from `--token` / `$VOID_DEV_TRIGGER`) for dev, and
`x-void-internal` (`--cron-secret` / `$CRON_SECRET`) only for non-local origins —
the prod secret never leaks to localhost.

```bash
# Flaky server returns 503 twice, then 200:
void-crons trigger heartbeat path/to/your-app --origin http://localhost:5499
# your-app: failed heartbeat * * * * *: HTTP 503 (HTTP 503, attempts 1)   exit 1

void-crons trigger heartbeat path/to/your-app --origin http://localhost:5499 --retries 3
# your-app: fired heartbeat * * * * * (542ms)                            exit 0
```

- Retries cover 429 / 408 / 425 / 5xx and network errors (including timeouts).
  A `401` or other 4xx is final — no retry.
- `--timeout MS` aborts each attempt; the entry records the abort message.
- Fire outcomes append to the activity store as `success` / `failed` entries —
  failures are history, not silence.
- The live loop dedupes per expression per minute, so a slow fire never double-fires.

## Manifest & drift

`emit` freezes `void.crons.json` at the app root — committed, reviewed, and used
as the CI baseline and deploy artifact:

```bash
void-crons emit path/to/your-app && void-crons check path/to/your-app
# your-app: clean (3 jobs, 4 expr, 4 sched)

# …someone edits crons/nightly.ts 0 2 → 0 3…
void-crons check path/to/your-app
# your-app: invalid
#   ✕ ~crons/nightly.ts cron '0 2 * * *' → '0 3 * * *'
#   run void-crons emit to regenerate
```

Drift compares active job paths and expression **sets** only — never `emittedAt`,
never ordering, never panel-only disable toggles (those live in the manifest's
own `disabled` list). Suggested CI:

```bash
void-crons check path/to/your-app --ci   # exit 1 on invalid jobs, limit overflow, or drift
```

## Activity history

`trigger`, `schedule --once`, and the live loop record every outcome to
`void.crons.activity.sqlite` (WAL mode, 5s busy-timeout, newest-100 trim) — the
same history `list` tails and `CronPanel` renders:

```bash
void-crons list path/to/your-app
#   ● heartbeat  * * * * *  next in <2m
#   ↳ heartbeat * * * * * success 0.0s
#   ↳ nine      0 9 * * * success 0.0s
```

Concurrency is safe: ten simultaneous `trigger` processes record ten rows, none
lost (verified live). `--store jsonl` selects the legacy line-delimited file;
a pre-existing `.json` array is read until the first new-store append supersedes
it. All three files are gitignored dev artifacts.

```ts
import { appendActivityLog, readActivityLog } from "void-crons";

appendActivityLog(appRoot, entries);          // sqlite by default
readActivityLog(appRoot, 5);                // newest-first
readActivityLog(appRoot, 5, "jsonl");       // legacy backend
```

## Library API

```ts
import {
  scanCronFiles,      // CronJob[] — parse + validate crons/ (opts.disabled)
  isCronExpression,   // boolean — shape + cron-parser range check
  buildCronManifest,  // counts, disabled list, invalid list
  emitCronManifest,   // write void.crons.json → { manifest, path }
  readCronManifest,   // stored manifest or null
  detectDrift,        // string[] — added/removed/changed lines
  triggerExpression,  // one fire → { ok, entry, httpStatus, attempts, retried }
  triggerJob,         // every expression a job exports (skips disabled/invalid)
  computeDue,         // due times in [fromMs, toMs], sorted ({ tz } aware)
  latestDue,          // most-recent due per expression (catch-up)
  runScheduleOnce,    // trailing-24h catch-up → { fired, skipped }
  tickSchedule,       // one live-loop window (per-expr once-per-minute)
  startScheduleLoop,  // 30s-tick live loop (opts.intervalMs/signal for tests)
  isValidTimezone, assertValidTimezone,
  createCronStore,    // in-memory record/list/toggle (prod swaps this)
  appendActivityLog, readActivityLog, pruneActivityLog,
} from "void-crons";
```

`collectScheduleTargets` maps expressions to owning jobs for the scheduler
(disabled → skips, invalid → dropped, shared expressions fire once).

## React panel

One component serves the in-app page and the dev overlay:

```tsx
import { CronPanel } from "void-crons/ui";
import { scanCronFiles } from "void-crons";

<CronPanel
  jobs={scanCronFiles(appRoot)}
  activity={store.list()}
  expressionCount={manifest.expressionCount}
  onToggle={(name, disabled) => store.setDisabled(name, disabled)}
  onTrigger={(job) => triggerJob(job, { origin, devToken })}
/>;
```

Toggle semantics: **Off skips local triggers and hides the job from
`void.crons.json`**. It is not a prod kill-switch — Cloudflare triggers can't be
disabled at runtime. Invalid jobs render with their error and no trigger button.

## The `void` module note

npm's `void` package is an unrelated CloudFront cache helper — the real Void SDK
(`defineScheduled`, `defineHandler`, `voidPlugin`) isn't published there. Until it
is, `src/void.d.ts` carries the local ambient contract so job files and routes
typecheck, and the scanner's alias/namespace detection mirrors exactly the surface
that stub declares. App `vite.config`s already tolerate the missing plugin:

```ts
try {
  const mod = require("void") as { voidPlugin?: () => { name: string } };
  if (typeof mod.voidPlugin === "function") voidPlugin = mod.voidPlugin;
} catch {
  // no Void SDK installed — plain Vite serves pages/routes for local dev
}
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `missing export const cron` | No literal export (dynamic value, typo, `_`-ignored file) | Export a string/array literal |
| `unsupported cron export` | `cron` bound to a variable/call | Use a literal or array of literals |
| `invalid cron expression … 0-59` | Out-of-range field | Check field ranges (`cron-parser` message names the bound) |
| `unsupported cron expression … 5-field` | Wrong field count / bad chars | Five fields, `* , - /` + digits/names |
| `unknown timezone "Foo/Bar"` exit 2 | Bad `--tz` | IANA name, e.g. `America/New_York` |
| `unknown store "bogus"` exit 2 | Bad `--store` | `sqlite` or `jsonl` |
| `no job "x" … not a 5-field cron expression` | Typo'd selector | `trigger <job\|expr> [app-path]` — app path goes *after* the selector |
| `failed … (attempts 4)` | Server failing after retries | Check server logs; 4xx never retry |
| `database is locked` (rare burst) | >WAL writer collision | Retried automatically via busy-timeout; rerun if it escapes |
| `no defineScheduled` badge | Handler not wrapped | `export default defineScheduled(…)` |
| `never` in `list` | Nothing due in 8 days (yearly, Feb 30) | Expected — not an error |
| `dist is stale` stderr note | Edited `src/` without building | `pnpm build` (bin falls back to `src/` meanwhile) |

## Known limits

- Retries cover *delivery* (reaching the server). Exactly-once across a CLI crash
  mid-flight isn't claimed — the fire POST isn't idempotent server-side.
- Activity state is file-local (`sqlite`/`jsonl`). Prod history belongs in KV/Drizzle
  behind `createCronStore`'s shape.
- Impossible-but-parseable dates (Feb 30) never fire rather than erroring.
- The live loop is a 30s-tick dev firer: no persistence across restarts, no
  backpressure, `Ctrl-C` exits 0.
