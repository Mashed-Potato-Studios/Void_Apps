# void-crons TUI — Design

Date: 2026-10-20
Status: approved design, pre-implementation
Package: `packages/crons` (`void-crons`)

## Intent

`void-crons` ships line-oriented commands (`list`, `check`, `emit`, `trigger`,
`schedule`). Local dev work means re-running commands to answer the same
questions: which jobs exist, when do they next fire, what failed, is the
manifest stale.

Add an interactive terminal UI over the same local data and actions. One
command, one app, live countdowns, keyboard actions. It is a developer
convenience layer, not a new source of truth: scanning, manifest, activity, and
trigger semantics come from existing library functions.

Success criteria:

- `void-crons ui <app>` renders jobs, next-fire countdowns, manifest state, and
  recent activity without leaving the terminal.
- Trigger, toggle, emit, and catch-up work from the keyboard and produce the
  same results as the equivalent CLI command.
- Terminal state is always restored, including on crash and signals.
- Renderer and reducer are testable without a pty.

## Scope

In scope (first cut):

- Explicit `ui [app-path]` command for a single app.
- Read: jobs, expressions, status, next fire, manifest missing/clean/drift,
  drift lines, recent activity, platform counts.
- Actions: trigger selected job, toggle enabled/disabled (session), emit
  manifest, catch-up (`schedule --once` semantics), refresh, quit.
- Flags shared with existing commands: `--tz`, `--store`, `--origin`,
  `--token`, `--retries`, `--timeout`.
- Zero new runtime dependencies.

Out of scope (non-goals):

- Multi-app switcher; `--all` is rejected.
- Starting/stopping the live `schedule` loop from inside the TUI.
- Persisting toggles implicitly. Only `emit` writes `void.crons.json`.
- Editing cron expressions or job files.
- Mouse input, theming, config files.
- Diff-based rendering. Full-frame redraw is sufficient.

## User experience

```
 void-crons · apps/coffee                        tz local · sqlite · :5173
 3 jobs · 4 expr · 4 sched          manifest clean · last scan 12:04:31
──────────────────────────────────────────────────────────────────────────
  ● cleanup     0 2 * * *           next in 18h     last ok 09:12
  ● heartbeat   * * * * *           next in <2m     last fail 2m · timeout
  ○ reports     */15 * * * *, …     disabled        last ok 40m
  ✕ draft.ts    invalid: missing export const cron
──────────────────────────────────────────────────────────────────────────
 Activity
  ↳ 14:02 heartbeat  * * * * *  success  24ms
  ↳ 14:01 heartbeat  * * * * *  failed   10.0s  timeout
──────────────────────────────────────────────────────────────────────────
 ↑↓/jk move · enter trigger · d toggle · e emit · c catch-up · r refresh · q quit
 status: ready
```

- Header: app name, job/expression/schedule counts, manifest state
  (`missing` / `clean` / `drift`), `tz`, store mode, origin host:port.
- Job rows: status marker (`●` active, `○` disabled, `✕` invalid), name,
  expression list, next-fire preview, last activity summary.
- Selected row is visually distinct; the list scrolls to keep it visible.
- Activity pane shows the recent entries (same store, default limit 5–10),
  collapsing to fewer rows on short terminals.
- Footer: fixed keymap plus one status line (ready / success / failure / busy
  label). A status clears on the next key press or action, not on a timer.
- Countdowns tick once per second. Full rescan on `r` and after each action.
- Under 60 columns: drop expression and last-activity columns. Under 40:
  compact single-line rows, no box chrome.
- `NO_COLOR` disables all ANSI styling. Existing markers are retained.
- Alternate screen buffer; cursor hidden while running; no mouse.

## Architecture

Pure core, thin terminal adapter. New code lives in `src/tui/`, separate from
the existing React panel in `src/ui/`.

```
src/tui/model.ts    TuiState, Msg union, reduce() — pure
src/tui/data.ts     loadSnapshot(): scan + manifest/drift + activity + nextFire
src/tui/render.ts   render(state, now) -> string[] — pure, width-aware
src/tui/keys.ts     keypress -> Msg
src/tui/run.ts      terminal lifecycle, action executor, tick/SIGWINCH loop
src/cli.ts          new `ui` case + usage text
test/tui.test.ts    reducer, render, data, headless loop
```

No subprocesses. The TUI calls the library directly:

- `scanCronFiles`, `readCronManifest`, `detectDrift`
- `readActivityLog`, `appendActivityLog` (through trigger/catch-up helpers)
- `computeDue` (next-fire previews)
- `triggerJob`, `emitCronManifest`, `runScheduleOnce`

### State

```ts
type TuiState = {
  appPath: string;
  appName: string;
  tz?: string;
  origin: string;
  storeMode: "sqlite" | "jsonl";
  jobs: JobView[];            // scan + nextFireMs + last activity
  manifest: "missing" | "clean" | "drift";
  drift: string[];
  activity: CronActivityEntry[];
  selected: number;
  scroll: number;
  disabled: Set<string>;      // session overlay, seeded from the manifest
  busy: null | { label: string };
  status: null | { kind: "info" | "success" | "error"; message: string };
  scannedAt: number;
  width: number;
  height: number;
};

type JobView = CronJob & {
  nextFireMs?: number | null;
  last?: CronActivityEntry;
};
```

`TuiState` is replaced, not mutated, by `reduce(state, msg)`. Messages:
`loaded`, `move`, `resize`, `toggle`, `busy`, `result`, `error`, `refresh`,
`quit`. Derived values (next-fire text, visible rows, footer) are computed in
`render`, never stored.

### Actions

- **Trigger** (`enter`): selected job only. Disabled or invalid → footer error,
  no network. Active → fire each expression with the existing retry/timeout
  path. Fired entries already land in the activity store; the view reloads.
- **Toggle** (`d`): flips membership in `disabled` and recomputes statuses.
  Session-only; disk is untouched.
- **Emit** (`e`): `emitCronManifest(app, { disabled: [...disabled] })`. This is
  the only action that persists toggles. It creates `void.crons.json` when
  absent (same as `emit`). Footer reports the written path.
- **Catch-up** (`c`): `runScheduleOnce` with current disabled set, `tz`, origin,
  token, retries, timeout, and store. Footer reports fired/skipped counts.
- **Refresh** (`r`): rescan jobs, manifest, drift, and activity.
- **Quit** (`q`, Ctrl-C): abort any in-flight action, clean up, exit 0.

One action at a time. While `busy`, all keys are ignored except `q`/Ctrl-C.
The runner owns an `AbortController` per action and aborts it on quit so a
pending fetch cannot outlive the UI.

### Rendering

- Width from `process.stdout.columns`, height from `process.stdout.rows`;
  clamp to safe minimums. Handle `SIGWINCH` by dispatching `resize`.
- Cells are built as plain text, padded to fixed widths, then styled, so ANSI
  codes never enter width math. Each line is truncated to the terminal width;
  scrolling is internal, never terminal wrap.
- Full redraw: cursor home (`ESC[H`), write all lines, clear below (`ESC[J`).
  Redraw on key, action result, and a 1 Hz tick.
- No per-frame allocations beyond the line array; no cursor addressing per cell.

### Terminal lifecycle

- Require `process.stdin.isTTY && process.stdout.isTTY`; otherwise print a
  stderr error and exit 2. No hidden fallback.
- Enter alternate buffer (`ESC[?1049h`), hide cursor (`ESC[?25l`), enable raw
  mode, `readline.emitKeypressEvents`.
- A single `cleanup()` restores cursor, leaves the alternate buffer, disables
  raw mode, removes listeners, and pauses stdin. It runs on normal quit,
  `SIGINT`, `SIGTERM`, uncaught exceptions, and unhandled rejections.
- Fatal initialization errors (missing app dir, scan throw, activity store
  open failure) are reported on stderr with exit 2 before the alternate buffer
  is entered.

### CLI surface

`void-crons ui [app-path] [--tz ZONE] [--store sqlite|jsonl] [--origin URL]
[--token T] [--retries N] [--timeout MS]`

- Defaults mirror existing commands.
- `--json` and `--all` are usage errors (exit 2) with a one-line explanation.
- `--help` keeps working.
- Add the command to `USAGE` and the README CLI table.
- Add a `./tui` export in `package.json` (source and publish config). Minor
  version bump at release.

## Error handling

- Action failures (HTTP, timeout, unknown job, invalid expression) become a red
  footer status. The UI stays usable and the previous state is preserved.
- Failed actions never append synthetic activity and never mutate the selected
  job's enabled state.
- Init failures exit before entering the alternate screen.
- Cleanup is idempotent; a second signal during cleanup does not re-enter it.

## Testing

`node:test` as elsewhere in the package. No pty required.

- **Reducer:** selection clamping at both ends, scroll keeps selection visible,
  toggle flips disabled/active and ignores invalid jobs, busy gates inputs,
  status replacement, resize clamping.
- **Render:** fixed 80×24 frame contains header, rows, activity, footer; long
  expressions truncate; narrow widths drop columns; no line exceeds the width;
  `NO_COLOR` output contains no escape codes; invalid rows show the error;
  empty app renders an empty-state message.
- **Data:** temp app fixture with cron files, a manifest, and activity; asserts
  manifest state/drift, next-fire presence, activity ordering.
- **Runner (headless):** `startTui(opts, deps)` accepts fake stdin/stdout,
  clock, and action functions. Feed keys, assert actions fire once, assert
  frames are rewritten, assert cleanup writes on `q` and on SIGINT.

## Known limits

- CJK and emoji filenames may misalign because width is computed as code points
  (zero new dependencies).
- Full redraw at 1 Hz is intentionally simple; very large job lists may flicker
  on slow terminals.
- Activity pane is read-only; clearing history stays a library/store concern.
