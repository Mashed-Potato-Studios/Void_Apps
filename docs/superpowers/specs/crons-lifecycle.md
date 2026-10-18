# @void-monorepo/crons — lifecycle Spec

Source: brainstorm session 2026-10-18. Builds on the existing scanner/manifest/trigger/store/panel package and its 12 passing node:test cases.

## Goal

Take `void-crons` from on-demand checker to self-serve lifecycle CLI a team runs daily: preview when jobs fire, catch drift between `void.crons.json` and `crons/` sources, and optionally hold a local scheduler that auto-fires expressions against the dev server — while keeping the package shape publishable and its machine output stable.

Non-goals: runtime prod scheduling (Cloudflare owns cron triggers in prod), killing the void dev plugin path (real Void SDK is absent from this repo — vite.config.ts loads npm `void@0.1.6` defensively as an unrelated pkg), disabling Cloudflare triggers at runtime, semantic cron validation beyond the existing shape check.

## Package

- Unchanged name `@void-monorepo/crons`, private today, publishable shape tomorrow.
- New dependency: `cron-parser` (validated for `*/5`, ranges, lists, day-of-month quirk handling). No other runtime deps; `bin/void-crons.mjs` stays a 10-line dist loader.
- New exports next to existing modules: `./schedule` (`computeDue`, `runScheduler`), drift helpers re-exported from `./manifest` end.
- Engines unchanged (`node >= 22.6`).

## Schedule command

```
void-crons schedule [app] [--origin URL default http://localhost:5173]
                     [--once] [--token T] [--json]
```

- Pure core `computeDue(expressions: string[], fromMs: number, toMs: number): { expr: string; dueMs: number }[]` — cron-parser iterDate stepping; the only place cron semantics live. Unit-tested with fixed clocks.
- Live loop: fixed 30s tick (no flag this iteration). Due since last checkpoint → `triggerExpression` → `appendActivityLog`. Checkpoint = in-memory last-fired minute per expression, so an expression fires at most once per matched minute even across overlapping windows.
- Startup line `scheduled 3 jobs · next 0 */2 * * * in 14m`; each fire prints one `fired cleanup 0 2 * * * (128ms)` line; Ctrl-C exits 0.
- `--once`: scans the trailing 24h window, fires the single most-recent due time per expression, appends activity, exits 0. The runbook/catch-up mode.
- Disabled jobs (manifest disabled list via `readDisabled`) never fire; invalid jobs print `✕ <error>` once at startup and are ignored until restart.
- `--json` on `--once` emits `{app, fired: [{cron, jobName, ok, httpStatus}], skipped: [{cron, reason}]}` shape with `format: 1`.

## Drift in check

```
void-crons check [app] [--all] [--no-drift]
```

- Default: when `void.crons.json` exists, compare manifest **active jobs+expression sets** against a fresh `scanCronFiles` (sets only — `emittedAt` never counts as drift). Human line: `drift: +cleanup.ts removed · +0 4 * * * new`; exit 1 on drift, 0 clean, 2 tool/usage error (house code split).
- `--no-drift`: old behavior only (invalid jobs + platform limits).
- Removes stale keys on `emit` (full-file rewrite already does this).
- Footer on drift: `run void-crons emit to regenerate`.

## list preview

- New trailing column `next in 4m` per active job (min across its expressions via `computeDue(nowMs, nowMs+8d)`); `never` when no due in 8 days. Disabled jobs show `—`. Hidden under `--json` output gets `nextFireMs` per job.

## Publishability

- `exports` keeps pointing at `src/` for workspace consumption; `publishConfig.exports` rewrites to `dist/` per package (pnpm swaps on publish, no dual-manifest maintenance).
- Every `--json` output gains `format: 1`; manifest schema unchanged (`format: 1` stays until fields break).
- `files` already `dist, bin, README.md`. No CI changes needed this iteration.

## Docs

README rebuilt to the void-fingerprint house pattern: tagline → Void contract → Quick start (list/check/emit/trigger/schedule with inline expected output) → CLI reference table w/ per-command exit codes → `--json` contract table → panel snippet → Known limits (shape-only validation, no prod kill-switch, secret-header policy, panel store swap note). Referenced example job: `apps/api/crons/cleanup.ts`.

## CI wiring

None new. `crons:check` already exists in `apps/api`; drift default-on may require one `.turbo` input list touch (`void.crons.json` added to `crons:check` inputs) — noted, not blocking.

## Acceptance

1. `void-crons list apps/api` shows active jobs with a `next in Xm` column; invalid jobs listed with their error and no preview.
2. Edit `crons/cleanup.ts` cron → `void-crons check apps/api` exits 1 and prints `drift:` naming the file; re-run `emit` then `check` → 0.
3. `void-crons schedule apps/api --once` (offline origin stub) fires exactly one POST per due expression, appends entries to `void.crons.activity.json`, exits 0.
4. Live `schedule` loop fires an expression whose next-due minute passes during the test window, exactly once (fakes clock + fetch).
5. Disabled job never fires under `schedule` or `--once`; invalid job prints its error at startup.
6. `check --no-drift` behaves byte-identically to pre-spec `check`. Existing 12 tests stay green throughout.
7. `check --ci --json` output parses and carries `format: 1`; README documents every command's exit codes.
