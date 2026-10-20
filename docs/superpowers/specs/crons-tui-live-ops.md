# void-crons TUI Live Ops — Design

Date: 2026-10-20
Status: approved design, pre-implementation
Package: `packages/crons` (`void-crons`)

## Intent

The TUI currently inspects jobs and runs one action at a time. Local dev still
requires a second terminal running `void-crons schedule` to watch fires happen.
This cut adds live scheduling and makes many-job apps navigable without leaving
the terminal.

Success criteria:

- Start and stop a live schedule loop from the TUI; fires land in activity and
  on screen without a separate CLI process.
- Find and compare jobs quickly with filter, sort, and a detail view.
- Editing cron files or emitting the manifest refreshes the TUI automatically.
- No new runtime dependencies; terminal always restored; tests need no pty.

## Scope

In scope:

- Manual live-loop start/stop (`s`), started from now with no backfill.
- Selected-job detail line and `v` full detail pane.
- Inline `/` filter and `o` sort cycle.
- `fs.watch` auto-rescan with debounce.
- Abort signal through `tickSchedule`.
- README + tests + TODO tracking.

Constraints:

- Zero new runtime dependencies.
- One app only.
- Loop starts stopped; no backfill on start.
- Loop ticks never overlap each other. A manual action suppresses new loop
  ticks; a manual action may start while a tick is in flight, and the tick's
  result is applied only if the loop is still running.
- Terminal always restored; tests need no pty.
- Package README stays generic (no monorepo-specific paths).

Non-goals:

- Multi-app switching or `--all`.
- Persisting the loop checkpoint across restarts.
- Catch-up on loop start (use `c`).
- Editing cron expressions or job files from the TUI.
- Custom sort menu, mouse, themes, or config files.
- Changing trigger/toggle/emit persistence semantics.

## UX

Keys:

| Key | Context | Action |
|---|---|---|
| `s` | normal | Start/stop the live loop |
| `/` | normal | Open inline filter with existing text |
| printable | filter input | Append to filter |
| `backspace` | filter input | Delete last filter character |
| `enter` | filter input | Apply and close filter input |
| `esc` | filter input | Clear filter and close |
| `esc` | normal | Close detail pane if open |
| `o` | normal | Cycle sort: next fire → name → status |
| `v` | normal | Toggle detail pane over the activity area |
| existing | normal | arrows/`jk`, `enter` trigger, `d` toggle, `e` emit, `c` catch-up, `r` refresh, `q` quit |

Header:

- Line 1: `void-crons · <app>` and `loop off` / `loop LIVE · N fired`, then
  `tz … · store … · origin`.
- Line 2: counts + `sort <mode>` on the left; manifest state + scan time on the
  right.

Footer:

- Normal idle: `status: ready`.
- Live idle: `status: live · N fired · next in Xm` using the minimum active
  `nextFireMs`.
- Filter input: `filter: <text> · enter apply · esc clear`.
- Transient action status keeps precedence over idle text.
- If the watcher failed: `status: watch unavailable — r to refresh` until an
  action replaces it.

Job list:

- Filtered/sorted rows, same columns as today.
- One detail line under the list for the selected job:

```
  crons/top-coffee.ts · defineScheduled · 1 expr · last ok 24ms
```

- If the selected job has an error, show it truncated in that line.
- No matches: `no jobs match "<filter>"`.
- No selection (empty list or empty filter result): detail line reads
  `no job selected`.

Detail pane (`v`):

- Replaces the activity pane; title `Detail · v close`.
- Lines: path, expressions, status, wrapper, shared-expression flag, next fire,
  last run (status, duration, items, source), full error text.
- Closing returns to Activity.

Loop states:

- Off: no ticks fired.
- Running: agent ticker evaluates due expressions every second.
- Stopped: checkpoint/state discarded; `s` starts clean from now.
- Loop runs across all active jobs regardless of filter.

## State

```ts
type SortMode = "next" | "name" | "status";

interface LoopState {
  running: boolean;
  checkpointMs: number;
  firedMinutes: Map<string, number>;
  firedTotal: number;
}

interface TuiState {
  // existing fields…
  loop: LoopState;
  filter: string;
  filterInput: boolean;
  sort: SortMode;
  detail: boolean;
}
```

Messages added:

```ts
| { type: "loop-toggle" }
| { type: "loop-start"; nowMs: number }
| { type: "loop-stop" }
| { type: "loop-result"; checkpointMs: number; firedMinutes: Map<string, number>; fired: number }
| { type: "loop-error"; message: string }
| { type: "filter-open" }
| { type: "filter-char"; char: string }
| { type: "filter-backspace" }
| { type: "filter-apply" }
| { type: "filter-clear" }
| { type: "sort-cycle" }
| { type: "detail-toggle" }
| { type: "escape" }
```

Derived helpers (pure, exported from `model.ts`):

- `visibleJobs(state): JobView[]` — filter then sort.
- `selectedJob(state): JobView | undefined` — `visibleJobs()[state.selected]`.
- `nextActiveFireMs(state): number | null` — minimum `nextFireMs` among active
  jobs, for the live footer.

Filter matching: case-insensitive substring against `name`, `path`, or the
joined expressions.

Sort order:

- `next`: active jobs with a non-null `nextFireMs` ascending, then nulls, then
  name.
- `name`: `localeCompare` on name.
- `status`: `active` → `disabled` → `invalid`, then name.

Selection:

- `selected` indexes the visible list.
- `filter-open`, `filter-char`, `filter-backspace`, `filter-clear`,
  `sort-cycle` reset selection/scroll to 0.
- `loaded` preserves the previously selected job by path when it still exists;
  otherwise clamps to the visible list.
- Trigger/toggle act on `selectedJob`.

## Live loop

- `s` dispatches `loop-start` with `nowMs = now()`. Reducer sets
  `running: true`, `checkpointMs: nowMs`, empty fired map, `firedTotal: 0`.
- The runner's existing 1 Hz tick calls the loop step when `running`, no manual
  action is busy, no loop tick is in flight, and the UI has not settled.
- Targets are rebuilt every tick from current jobs:

```ts
const active = new Map<string, string>();
for (const job of state.jobs) {
  if (job.status !== "active") continue;
  for (const expr of job.expressions) {
    if (!active.has(expr)) active.set(expr, job.name);
  }
}
```

- The step calls `tickSchedule` from `schedule.ts` with the persisted
  checkpoint/fired map, current time, `tz`, origin, dev token, timeout,
  `maxAttempts = retries + 1`, store mode, `appendActivity: { appRoot }`, and a
  loop `AbortController` signal.
- On result: reducer stores the new checkpoint/fired map, adds `fired.length` to
  `firedTotal`; runner reloads jobs/activity when at least one job fired so
  next-fire previews advance.
- Per-job HTTP failures are normal activity entries; the loop continues.
- A thrown scheduler error dispatches `loop-error`, stops the loop, aborts the
  controller, and shows `status: error: <message>`.
- `s` while running aborts the in-flight tick, dispatches `loop-stop`, and
  discards loop state.
- Quit aborts the loop controller.
- Toggling a job updates its status immediately; the next tick sees the new
  targets. No loop restart needed.
- Manual trigger/catch-up/emit remain available while live. Loop ticks are
  suppressed while a manual action is in flight; manual actions may still be
  started while a loop tick is in flight, but the loop tick's result is applied
  only if still running.

## Watcher

- `src/tui/watch.ts` exports `startWatcher(paths, onChange): WatcherHandle`
  where `WatcherHandle` has `close()`.
- Watch `appPath/crons` recursively and `appPath` non-recursively, filtering
  root events to `void.crons.json`.
- Ignore activity files (`void.crons.activity.*`) — they are not in the watch
  set.
- Debounce 200 ms; multiple events collapse into one callback.
- Missing `crons/` or a `fs.watch` failure is non-fatal: return a handle with a
  `failed` flag; startup continues; footer notes `watch unavailable — r to refresh`.
- Runner sets `watchDirty` on a callback and applies a rescan on the next tick
  when no manual action is busy. Applying uses the normal `loaded` path, so
  filter/sort/detail/toggles/selection survive.
- Cleanup closes both watchers.

## Rendering

- Job row height budget drops by one for the always-on detail line.
- Detail line is truncated to width; at narrow widths it keeps path + status.
- `v` pane uses the activity row budget; activity hidden while open.
- Filter input replaces the keymap footer line; the status line stays.
- Header truncates right-side metadata first at narrow widths.
- No ANSI in width math; existing pad-then-style rule continues.

## Error handling

- Watcher failure is non-fatal and reported once in the footer.
- Loop scheduler throw stops the loop; the TUI stays usable and `s` restarts.
- Loop tick aborted by stop/quit must not append activity. `tickSchedule` passes
  the signal to `triggerExpression`, which already returns `reason: "aborted"`
  with no entry.
- Cleanup is idempotent: closes watchers, aborts loop/manual controllers, clears
  the tick, removes listeners, restores cursor/raw mode/alternate screen.

## Files

- Modify: `src/tui/model.ts`
- Modify: `src/tui/keys.ts`
- Modify: `src/tui/render.ts`
- Modify: `src/tui/run.ts`
- Create: `src/tui/watch.ts`
- Modify: `src/schedule.ts`
- Modify: `test/tui.test.ts`
- Modify: `README.md`
- Modify: `TODO.md`

## Testing

No pty. `TuiDeps` gains `watch` (watcher factory) and `tickSchedule` overrides so
loop/watch tests run headless.

- Model: loop start/stop/result, fired total; filter matching; all sort orders;
  path-preserving selection; filter editing; toggle targets visible selection.
- Keys: filter-mode printable/backspace/enter/escape; `s/o/v`; existing keys
  unchanged.
- Render: loop badge/footer, filter prompt, no-match state, detail line, `v`
  pane, width safety at 88×17 and 39×13.
- Watcher: debounce collapse, activity events ignored, close on cleanup,
  failure non-fatal.
- Runner: `s` start/stop, tick fires and reloads, busy suppresses tick, quit
  aborts, watch event refreshes.
- Schedule: abort signal reaches fetch and writes no synthetic activity.

## Docs

- README keymap: add `s`, `/`, `o`, `v`; explain filter input, sort cycle, live
  loop, detail pane, and auto-rescan.
- Update known limits: 1 Hz redraw remains; live loop is dev-only and not
  persisted.
- Minor version bump to `0.3.0` at release.

## Known limits

- Loop state is in-memory; restarting the TUI forgets the checkpoint.
- One app only.
- 1 Hz full redraw can flicker with very large job lists on slow terminals.
- Watcher behavior follows `fs.watch` platform semantics; debounce absorbs most
  duplicate events, and manual `r` remains the fallback.
