# `void-crons`

![version](https://img.shields.io/badge/version-0.4.0-blue)
![node](https://img.shields.io/badge/node-%3E%3D22.6-339933?logo=node.js&logoColor=white)
![type](https://img.shields.io/badge/module-ESM-yellow)
![license](https://img.shields.io/badge/license-MIT-green)
![cron-parser](https://img.shields.io/badge/cron--parser-v5-orange)
![react](https://img.shields.io/badge/react-18_%7C_19_optional-61dafb)
![platform](https://img.shields.io/badge/platform-cloudflare-F38020?logo=cloudflare&logoColor=white)
![npm](https://img.shields.io/badge/npm-void--crons-CB3837?logo=npm&logoColor=white)
![repo](https://img.shields.io/badge/repo-GitHub-181717?logo=github)

> **For apps built on [Void Cloud](https://void.cloud/)** — the Vite-based framework
> for deploying to Cloudflare. App discovery recognizes `void.config.ts`,
> `void.config.mts`, `void.config.js`, `void.config.mjs`, and legacy `void.json`,
> alongside a `crons/` directory.
>
> Source, issues, and releases:
> [Mashed-Potato-Studios/Void_Apps](https://github.com/Mashed-Potato-Studios/Void_Apps).

Local lifecycle for Void `crons/` — scan, validate, preview, manifest, drift-check,
catch-up, live scheduling, retries, activity history, and an interactive terminal
UI with a live loop, filtering, and job detail. One CLI (`void-crons`), one
library, one React panel.

New to Void? Start at [void.cloud](https://void.cloud/) — particularly the
[jobs guide](https://void.cloud/guide/jobs), which defines the `crons/` contract
this package implements locally.

```bash
npm i -g void-crons
cd path/to/your-app                             # app config + crons/
void-crons doctor                              # inspect SDK/config boundaries
void-crons check && void-crons emit             # CI gate + local inspection artifact
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
- [Worker runtime instrumentation](#worker-runtime-instrumentation)
- [Worker-safe adapters](#worker-safe-adapters)
- [Integration boundaries and evidence](#integration-boundaries-and-evidence)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)

## The Void contract

Each file in `crons/**/*.ts` (`.mts`, `.js`, `.mjs` also accepted) must export:

```ts
// crons/cleanup.ts
import { defineScheduled } from "void";

export const cron = "0 2 * * *"; // or ["0 2 * * *", "30 * * * *"]

export default defineScheduled(async ({ cron, scheduledTime }, env, ctx) => {
  // ... do the work ...
  return { purged: 4 };
});
```

- `export const cron` — one 5-field expression, or an array of them.
- A default handler — receives `(controller, env, ctx)`; the controller includes
  `{ cron, scheduledTime }`. `defineScheduled` is recommended and feeds the
  `usesDefineScheduled` badge, but is an identity wrapper, not instrumentation.
  Contract source of truth: [void.cloud/guide/jobs](https://void.cloud/guide/jobs).
- Files or directories starting with `_` are ignored entirely.
- One expression dispatch fans out to **every matching handler**, not just the
  selected filename. Shared expressions count once toward the managed quota
  profile (100 distinct expressions, 1000 schedules); external quotas vary.

```
crons/
  cleanup.ts      # 0 2 * * *      nightly purge
  heartbeat.ts    # * * * * *      every minute
  reports.ts      # */15 * * * * + 30 9 * * 1
  _draft.ts       # ignored (leading underscore)
```

## Quick start

Every command takes an optional app path — the directory containing a supported
Void config and `crons/`. **Omit it to use the current directory.** The examples below run
from inside the app directory:

```bash
cd path/to/your-app

# 1. See what the scanner finds (previews use UTC by default)
void-crons list
# your-app: 3 job(s)
#   ● cleanup    0 2 * * *  next in 18h
#   ● heartbeat  * * * * *  next in <2m
#   ● reports    */15 * * * *, 30 9 * * 1  next in 6m

# 2. Gate on it, then freeze the local inspection artifact
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

Runs per-app. `[app-path]` is the directory containing a supported Void config and
`crons/`; omit it to use cwd. `--all` scans `apps/*` for any supported config.
`trigger` is the one exception: the job selector comes first, then the optional
app path (`void-crons trigger cleanup path/to/your-app`).

| Command | What it does | Non-zero exit |
|---|---|---|
| `list [app-path] [--tz Z]` | Scanned jobs, `next in Xm` previews, activity tail. `--json` adds `nextFireMs` per active job | `1` if any job invalid |
| `ui [app-path] [--tz Z] [--store MODE] [--origin URL]` | Interactive TUI: jobs, countdowns, drift, activity; trigger/toggle/emit/catch-up | `2` if not a TTY or `--json`/`--all` used |
| `check [app-path] [--limits managed\|none]` | Invalid jobs, selected quota profile, manifest drift (skip drift with `--no-drift`) | `1` problems/drift · `2` tool error |
| `doctor [app-path] [--json] [--all] [--evidence FILE]` | Reports config, resolved SDK version/contract, unknown bindings, production-trigger evidence, local manifest role | `2` tool error |
| `verify [app-path] --origin URL --transport framework --cron EXPR --evidence FILE --allow-remote --confirm-remote-write` | Dispatches one real remote job and writes sanitized proof; HITL, requires staging and `$CRON_SECRET` | `1` rejected · `2` usage/target error |
| `emit [app-path]` | Writes `void.crons.json` | `2` on tool error |
| `schedule [app-path] --once [--tz Z] [--retries N]` | Fires the most-recent due per expression in the trailing 24h | `1` on fire failures |
| `schedule [app-path] [--tz Z] [--retries N]` | Live loop: 30s ticks, each expression fires at most once per matched minute | `2` on bad flags |
| `trigger <job\|expr> [app-path] [--retries N]` | Manual fire via `POST /__void/scheduled`. `--cron EXPR` overrides the job's expression | `1` HTTP/unknown job · `2` usage |

Exit codes: `0` clean · `1` drift / invalid / failed fire · `2` tool, usage, or flag error
(includes unknown `--tz` / `--store`).

| Flag | Default | Meaning |
|---|---|---|
| `--origin URL` | `http://localhost:5173` | HTTP(S) origin only: no credentials, path, query, or fragment; redirects rejected |
| `--cron EXPR` | job's own | Dispatch this expression, not an isolated job; all matching handlers may run |
| `--token T` | `$VOID_DEV_TRIGGER` | Sent as `x-void-dev-trigger` |
| `--transport MODE` | `dev` | `dev` requires exact loopback; `framework` requires non-loopback HTTPS, `--allow-remote`, and `$CRON_SECRET` |
| `--allow-remote` | off | Explicit consent for framework dispatch; required, but not proof of endpoint verification |
| `--confirm-remote-write` | off | `verify` only: acknowledges that a real production job will run |
| `--evidence FILE` | — | Read production proof for `doctor`/`trigger`, or write it with `verify` |
| `--binding-mode MODE` | `unknown` | Caller assertion: `local`, `remote`, or `unknown`; not automatically detected |
| `--allow-remote-bindings` | off | Explicit consent when binding mode is declared `remote`, even on loopback |
| `--limits PROFILE` | `managed` | `check`: enforce 100 expressions/1000 schedules, or `none` to check external quotas separately |
| `--tz ZONE` | UTC | IANA zone (`America/New_York`) for previews + schedule windows |
| `--retries N` | `0` | Retry 408 / 425 / 429 / 5xx / network failures; 500ms doubling backoff; other 4xx are final |
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

Start it **from the app directory** — the one containing a supported Void config and
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

The scanner parses TypeScript syntax without executing job modules. Mixed
literal/dynamic arrays and missing default handlers are invalid; commented-out
schedules never ghost:

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

Expressions are checked against Cloudflare's Cron Trigger grammar, not just
`cron-parser`'s dialect:

- five fields; day-of-week is Quartz-numbered (**`1` = Sunday … `7` = Saturday**),
- `L`, `LW`, `<n>W`, `L-<n>`, `<n>L`, `<n>#<k>` and `?`,
- month names (`JAN-DEC`) and day names (`SUN-SAT`).

| Expression | Result |
|---|---|
| `0 2 * * *` | ✅ |
| `0 9 * * MON` | ✅ day names |
| `0 18 * * 6L` | ✅ last Friday (`6` = Friday) |
| `0 9 * * 2#2` | ✅ second Monday |
| `59 23 LW * *` | ✅ last weekday of the month |
| `0 0 15W * *` | ✅ nearest weekday to the 15th |
| `0 0 L-3 * *` | ✅ three days before month end |
| `* * * * 0` | ❌ Cloudflare day-of-week starts at `1` |
| `99 99 99 99 99` | ❌ out of range |
| `0 0 1 13 *` | ❌ month 13 out of range |
| `*/0 * * * *` | ❌ step must be at least 1 |

Supported forms `cron-parser` cannot evaluate (`LW`, `15W`, `L-3`) run through a
built-in Quartz evaluator for `list`, `schedule --once`, and the live loop.
Local previews are not evidence of deployed scheduler delivery. Impossible dates
(Feb 30) never throw — they simply never come due.

## Timezones

Cloudflare evaluates Cron Triggers in **UTC**, so previews and the local
scheduler default to UTC — no flag needed:

```bash
void-crons list path/to/your-app
#   ● nine  0 9 * * *  next in 20h        (09:00 UTC)
```

`--tz` previews another wall clock deliberately:

```bash
void-crons list path/to/your-app --tz America/New_York
#   ● nine  0 9 * * *  next in 24h        (09:00 New York)
void-crons list path/to/your-app --tz Pacific/Kiritimati
#   ● nine  0 9 * * *  next in 6h
```

`--tz` applies to `list` previews, `schedule --once`, and the live loop
(`scheduled … · tz America/New_York` in the banner). Unknown zones exit 2 with
the offending name echoed. `check`/`emit` are zone-independent (they compare
expression sets, never fire times).

## Delivery: retries, timeouts, exit codes

Every fire is `POST {origin}/__void/scheduled` with `{cron, scheduledTime}`.
Default `dev` transport accepts only exact `localhost`, `127.0.0.1`, or `[::1]`
hosts and sends `x-void-dev-trigger` from `--token` / `$VOID_DEV_TRIGGER`.
The SDK's `.void/dev-trigger-token` is a credential; this CLI does not
automatically read it. Never commit it or expose it to browser code.

Remote dispatch requires explicit `--transport framework --allow-remote`, a
non-loopback HTTPS origin, and `CRON_SECRET` in the CLI environment. There is
**no `--cron-secret` flag**. This transport sends only `x-void-internal`, never
the dev token. The library enforces the same `allowRemote` consent, so a caller
cannot reach the framework path by constructing options alone.

`doctor` reports production triggering as `unknown` until an accepted evidence
file is supplied. Prove a staging target with `verify` before treating the
transport as production-ready:

```bash
CRON_SECRET=... void-crons verify path/to/app \
  --origin https://staging.example.com --transport framework \
  --cron "0 2 * * *" --evidence void.crons.production.json \
  --allow-remote --confirm-remote-write
void-crons doctor path/to/app --evidence void.crons.production.json
```

`verify` writes only target origin, transport, auth mode, outcome, HTTP status,
timestamp, and expression. It never writes the secret. A rejected response
writes `outcome: "rejected"`; a network/timeout with no HTTP response writes
`outcome: "unknown"`. `doctor` reports either state rather than silently
claiming success, and only an accepted 2xx response counts as verified. Native
production manual HTTP triggering remains **unverified**; native scheduled
events are a separate platform mechanism, not this HTTP transport.

Loopback does **not** imply local data: local Void servers may use remote
bindings. `--binding-mode` is your assertion, not discovery. Declaring `remote`
requires `--allow-remote-bindings`; `unknown` warns but is not blocked. Inspect
the consuming app's actual bindings and prefer staging for catch-up/replay.

```bash
# Flaky server returns 503 twice, then 200:
void-crons trigger heartbeat path/to/your-app --origin http://localhost:5499
# your-app: failed heartbeat * * * * *: HTTP 503 (HTTP 503, attempts 1)   exit 1

void-crons trigger heartbeat path/to/your-app --origin http://localhost:5499 --retries 3
# your-app: fired heartbeat * * * * * (542ms)                            exit 0
```

- Retries cover 429 / 408 / 425 / 5xx and network errors (including timeouts).
  A `401` or other 4xx outside 408/425/429 is final — no retry.
- `--timeout MS` aborts the client request, not necessarily server execution.
  Exhausted network errors/timeouts record `unknown`: the handler may have run.
- HTTP acknowledgement is **not independently observed handler success**.
  Activity entries have `kind: "dispatch"`, `affectedJobs`, and `bindingMode`;
  `success` / `failed` describe HTTP dispatch, not each handler's business result.
- Retries replay the entire expression, including siblings that already
  succeeded. Unknown outcomes and aggregate failures can duplicate effects;
  handlers need application-owned idempotency before retries are safe.
- The live loop dedupes per expression/minute within its process; that is not
  exactly-once execution or durable deduplication across restarts.

A locally disabled sibling blocks the **whole shared-expression group**, since
the endpoint cannot omit that handler. CLI/TUI supply the complete scanned job
list; library callers should pass `jobs` and current `disabled` preferences to
`triggerJob` / `triggerExpression`. A known shared job without `jobs` is refused.
Local disable is not a deployed pause and does not remove platform schedules.

## Manifest & drift

`emit` freezes `void.crons.json` at the app root for local inspection and a
reviewable CI drift baseline. **The inspected Void SDK does not consume this
manifest**: `void deploy` independently scans job source and builds schedules.
Editing this file does not change deployed schedules or pause deployed handlers:

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

The manifest also carries a `schedules` array — one `{ name, cron }` entry per
active expression, named by the file's path inside `crons/`
(`crons/billing/daily.ts` → `billing/daily`). That is the same shape
the inspected SDK publishes, so it can support a manual comparison with actual
deployment evidence; it is not proof of deployed state. Shared expressions count
once toward the managed profile's 100-expression limit. Use `check --limits none`
for external targets only after checking their effective quotas separately.

## Activity history

`trigger`, `schedule --once`, and the live loop append dispatch entries to
`void.crons.activity.sqlite` (WAL mode, 5s busy-timeout, newest-100 trim) — the
same history `list` tails and `CronPanel` renders:

```bash
void-crons list path/to/your-app
#   ● heartbeat  * * * * *  next in <2m
#   ↳ heartbeat * * * * * success 0.0s
#   ↳ nine      0 9 * * * success 0.0s
```

SQLite uses WAL and a busy timeout for concurrent local writers; this is not a
distributed run store. `--store jsonl` selects the legacy line-delimited file;
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
  isCronExpression,   // boolean — Cloudflare grammar (Quartz DOW, L/W/#/?)
  validateCloudflareCron, // string | null — grammar problem for an expression
  cfCronToUnix,       // string — Quartz DOW → cron-parser DOW
  isPreviewSupported, // boolean — next-fire/catch-up can be computed locally
  buildCronManifest,  // counts, schedules[], disabled list, invalid list
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
  createCronStore,    // synchronous in-memory activity/toggles, not CronRunStore
  appendActivityLog, readActivityLog, pruneActivityLog,
} from "void-crons";
```

`collectScheduleTargets` maps expressions to owning jobs for the scheduler
(a disabled member blocks its entire group; shared expressions dispatch once
and fan out server-side). The root `void-crons` entry is **Node-only**, importing
filesystem and Node SQLite code. Do not import it into a Worker or browser;
use `void-crons/runtime` for Worker handler instrumentation.

## React panel

The React component renders supplied data and callbacks; it does not scan files,
persist runs, authenticate requests, or install a dev overlay. Keep Node scanning
and internal credentials on the server. For example, in an app component with
server-loaded `jobs`, `activity`, and `expressionCount`:

```tsx
import { CronPanel } from "void-crons/ui";

<CronPanel
  jobs={jobs}
  activity={activity}
  expressionCount={expressionCount}
  onToggle={(name, disabled) => { void saveLocalPreference(name, disabled); }}
  onTrigger={(job) => { void requestManualDispatch(job.name); }}
/>;
```

`saveLocalPreference` and `requestManualDispatch` are application-owned,
server-authorized callbacks, not package exports. The server must rescan with
current disabled preferences and pass the complete `jobs` list when dispatching.
Toggle semantics: **Off skips local dispatch and omits the job from the local
manifest's active schedules**. A disabled sibling blocks shared expressions.
It is not a production kill-switch. Invalid jobs have no trigger button.

## Worker runtime instrumentation

`void-crons/runtime` is Worker-safe and has no Node filesystem/SQLite imports.
It exports `instrumentScheduled`, `CronRunStore`, and runtime record/options
types. Wrap the actual `(controller, env, ctx)` handler inside `defineScheduled`:

```ts
import { defineScheduled } from "void";
import { instrumentScheduled, type CronRunStore } from "void-crons/runtime";
import { cleanup, persistRun, publishRun, readPause } from "../server/cron-support";

export const cron = "0 2 * * *";

const runStore: CronRunStore = {
  async record(run) {
    await persistRun(run);
  },
};

export default defineScheduled(instrumentScheduled(
  "cleanup",
  cleanup,
  {
    store: runStore,
    isPaused: async (controller, env, ctx) => readPause("cleanup", env),
    notify: async (run, controller, env, ctx) => publishRun(run, env),
    onTelemetryError: (error, stage) => { console.error("cron telemetry", stage, error); },
  },
));
```

The `../server/cron-support` module is application code you must implement using
your app's SDK bindings/auth; these helpers are not package exports.
`CronRunStore.record(run): Promise<void>` is asynchronous, unlike the local
`createCronStore`. Persist authoritative records in an app-owned store first;
the wrapper awaits `record`, then optionally `notify(run, controller, env, ctx)`.
Notification is skipped when storage fails, so a live event is never proof of
persistence and consumers must refetch and reconcile after reconnect.

Records include `id`, `jobName`, `cron`, numeric `scheduledTime`, `startedAt`,
`finishedAt`, `durationMs`, and `status: "success" | "failed" | "skipped"`.
The wrapper forwards all three arguments, preserves handler results and thrown
values, and isolates telemetry failures via `onTelemetryError(error, stage)`.
A pause-check error fails closed (skips work); pause state/storage are app-owned.
`now` and `createId` can be injected. Supply `idempotencyKey` for stable
duplicate-delivery IDs; the default `createId` is random. Run IDs are
correlation, not idempotency unless the app makes the key stable.

## Integration boundaries and evidence

The installed SDK inspected on October 22, 2026 was `void@1.1.11`; this is not a
latest-version claim. `doctor` resolves the SDK from the consuming app and reports
config/version and capability boundaries, not deployed reachability, auth,
effective quotas, or detected binding mode. The obsolete ambient `void` shim is
removed; consuming apps use the actual SDK types.

See the [assessment](../../docs/research/2026-10-22-void-crons-assessment.md) for
the pre-fix findings and its dated verification snapshot, and the
[platform research](../../docs/research/2026-10-22-void-crons-platform-research.md)
for version-pinned SDK contracts and unverified deployment boundaries. Historical
test counts there are not a current test badge.

The runtime does not provision resources or install adapters automatically.
The optional Worker-safe adapters are app-owned boundaries:

- `void-crons/d1` — D1 ledger adapter with idempotent inserts, query APIs, and
  retention. Copy `migrations/0001_cron_runs.sql` into the consuming app.
- `void-crons/queue` — typed cron → queue correlation with separate enqueue,
  consumer start, completion, retry, and exhaustion records.
- `void-crons/durable` — native-only lease/pause coordination over an
  application-owned durable-state store; job work runs outside state methods.
- `void-crons/live` — small post-persistence notifications plus fail-closed
  topic authorization. Live streams are at-most-once, not replayable history.

These adapters still require the consuming app's bindings, authorization,
idempotency, migrations, and separate native/framework verification. The
package does not install them, own their data, or prove deployed behavior.

## Worker-safe adapters

All four adapter subpaths avoid `node:` imports and can be bundled for a Worker.
They are exported separately from the Node-only root entry.

### D1 ledger (`void-crons/d1`)

```ts
import { createD1CronStore } from "void-crons/d1";
import { instrumentScheduled } from "void-crons/runtime";

const store = createD1CronStore({ db: env.DB, retentionMs: 30 * 24 * 60 * 60 * 1000 });
await store.ensureSchema(); // idempotent; or apply migrations/0001_cron_runs.sql first

export default instrumentScheduled("cleanup", cleanup, {
  store,
  idempotencyKey: ({ cron, scheduledTime }) => `cleanup:${cron}:${scheduledTime}`,
});
```

`record(run)` writes a `handler` event. `recordEvent(event)` writes dispatch,
queue, and other ledger phases, for example:
`{ id, runId, phase: "dispatch", status: "success", ... }`. `id` is the idempotency key, so duplicate
telemetry delivery inserts once. `list(limit)`, `get(id)`, and
`listByRun(runId)` are the query surface. Errors are stored as bounded,
redacted summaries; raw error objects and headers are never persisted. The
adapter prunes records older than `retentionMs` on write; set `0` to disable.
Schema initialization is explicit: the adapter never auto-creates tables, and
`ensureSchema()` (or the migration) must run before writes or queries.

### Queue correlation (`void-crons/queue`)

```ts
import { createCronQueueCorrelation } from "void-crons/queue";

const correlation = createCronQueueCorrelation({
  store, // any CronLedgerStore, including the D1 adapter
  sender: { send: (message) => queues.coffee.send(message) },
});

const published = await correlation.publish({
  runId, jobName: "cleanup", cron: "0 2 * * *", scheduledTime, body: { batch: 1 },
});

const result = await correlation.consume(published.message, async (body) => {
  await doWork(body);
}, { maxAttempts: 3 });
if (result.shouldRetry) message.retry({ delaySeconds: 30 });
```

The message carries `runId`, `dispatchId`, `jobName`, `cron`, `scheduledTime`,
`attempt`, `idempotencyKey`, and the typed body. Void queue consumer defaults
are `maxBatchSize: 10`, `maxBatchTimeout: 5s`, `maxRetries: 3`, and
`retryDelay: 0s`; check the consuming app rather than assuming them. Duplicate enqueues and
duplicate successful deliveries are skipped through the ledger's `has` query.
`has` is not a distributed lock: the consumer handler must still be idempotent
for concurrent deliveries, and the queue should serialize per idempotency key
where the platform allows it. Enqueue acknowledgement is never reported as
consumer completion;
retry and exhaustion are separate ledger phases. Void-managed queues have no
automatic DLQ, so `exhausted` is the durable terminal record.

### Durable coordination (`void-crons/durable`)

```ts
import { createCronCoordinator } from "void-crons/durable";

const coordinator = createCronCoordinator({ store: durableState });
const run = await coordinator.withLease("cleanup", "worker-a", 60_000, async () => {
  await cleanup(); // outside the serialized state transition
});
```

Native Void apps only. The app exposes the coordinator methods through its
`defineDurableState` definition; this package does not import or provision the
SDK. Claims, leases, pause state, and alarms are authoritative for the app;
the coordinator serializes its own calls, but cross-instance atomicity comes
from the durable object's serialized methods. Do not acquire leases outside
that context.
`withLease` fails closed when pause or coordination state is unavailable.
Lease acquisition, queue publishing, and external side effects are not one
transaction. Make post-lease work idempotent and reconcile partial external
effects after a crash; a lease prevents overlap, not duplicate side effects.
In the durable object's `alarm()` hook, call
`handleAlarm([...jobNames])` to clear expired leases. Durable state survives
code rollback; this package does not migrate or delete it.

### Live notifications (`void-crons/live`)

```ts
import { createCronLiveNotifier, createCronTopicAuthorizer } from "void-crons/live";

const notifier = createCronLiveNotifier({
  stream: live,
  topic: "crons",
  onError: (error) => console.error("live publish failed", error),
});

export default instrumentScheduled("cleanup", cleanup, {
  store,
  notify: async (run) => { await notifier.notify(run); },
});

const canSubscribe = createCronTopicAuthorizer({
  authorize: (topic, session) => session.role === "admin",
});
// App-owned live stream:
// onSubscribe: ({ topic, context }) => canSubscribe(topic, context)
```

`instrumentScheduled` awaits persistence before calling `notify`, so a live
event is never the source of truth. Call `notifier.notify` only from that
post-persistence hook, not with an arbitrary unpersisted record. Publish
failures do not fail business work.
Clients must refetch after reconnect: live events are at-most-once and not
stored. Use `createCronTopicAuthorizer` in the app's `live.onSubscribe`; it
denies by default when authorization fails or throws.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `missing export const cron` | No literal export (dynamic value, typo, `_`-ignored file) | Export a string/array literal |
| `unsupported cron export` | `cron` bound to a variable/call | Use a literal or array of literals |
| `invalid cron expression … 0-59` | Out-of-range field | Check field ranges (the message names the bound) |
| `unsupported cron expression … 5-field` | Wrong field count | Five fields: `* , - /` + digits/names, plus `L W # ?` |
| `unknown timezone "Foo/Bar"` exit 2 | Bad `--tz` | IANA name, e.g. `America/New_York` |
| `unknown store "bogus"` exit 2 | Bad `--store` | `sqlite` or `jsonl` |
| `no job "x" … not a 5-field cron expression` | Typo'd selector | `trigger <job\|expr> [app-path]` — app path goes *after* the selector |
| `failed … (attempts 4)` | HTTP dispatch failure after retries | Inspect all matching handlers; 408/425/429 may retry, other 4xx do not |
| `unknown` activity | Network/timeout outcome is uncertain | Reconcile server-side run records before replaying |
| remote binding/transport refusal | Missing explicit consent or wrong origin/auth | Inspect bindings; use the transport and consent flags described above |
| `database is locked` (rare burst) | >WAL writer collision | Retried automatically via busy-timeout; rerun if it escapes |
| `D1 cron store schema is not initialized` | Adapter used before `ensureSchema()`/migration | Call `ensureSchema()` once at startup |
| `no defineScheduled` badge | Handler not wrapped | `export default defineScheduled(…)` |
| `never` in `list` | Nothing due in the 40-day preview horizon (yearly, Feb 30) | Expected — not an error |
| `dist is stale` stderr note | Edited `src/` without building | `pnpm build` (bin falls back to `src/` meanwhile) |

## Known limits

- Retries repeat expression dispatch, not just failed handlers. Exactly-once
  isn't claimed; unknown network outcomes may already have produced effects.
- CLI activity is file-local (`sqlite`/`jsonl`) dispatch history. Production
  handler history needs an app-owned async `CronRunStore`, not `createCronStore`;
  `void-crons/d1` is one adapter, not an automatic deployment.
- Local manifests/toggles do not configure deployment or pause deployed work;
  runtime pause checks must be wired to authoritative application state.
- Impossible-but-parseable dates (Feb 30) never fire rather than erroring.
- The live loop is a 30s-tick dev firer: no persistence across restarts, no
  backpressure, `Ctrl-C` exits 0.
