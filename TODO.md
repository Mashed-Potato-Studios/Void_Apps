## Done

### TUI live ops (0.3.0)

- [x] Live schedule loop, start/stop with `s` (`8615d14`)
- [x] Job detail line + `v` detail pane (`5cb43d0`)
- [x] `/` filter and `o` sort cycle (`8615d14`, `5cb43d0`)
- [x] `fs.watch` auto-rescan with debounce (`986f5aa`)
- [x] Abortable schedule ticks (`757b8ee`)
- [x] Runner loop + watcher integration (`4d98e6b`)
- [x] Tests: model, keys, render, watcher, runner, abort (`4d98e6b`)
- [x] README live-loop/filter/sort/detail docs, screenshot, `0.3.0`

### TUI (0.2.0)

- [x] Task 1: State model and reducer (`2402570` — `TuiState`, `Msg`, `reduce()`, `createState`)
- [x] Task 2: Width-safe renderer (`0a337bb` — `src/tui/render.ts`, pure, width-aware, `NO_COLOR` clean)
- [x] Task 3: Snapshot loader (`74040f7` — `src/tui/data.ts`, scan + manifest/drift + activity + nextFire)
- [x] Task 4: Key mapping (`6ed778f` — `src/tui/keys.ts`, keypress to `Msg`)
- [x] Task 5: Abort plumbing (`14b62e7` — `signal` through trigger + `runScheduleOnce`, never retries on abort)
- [x] Task 6: Terminal runner (`08c715a` — `src/tui/run.ts`, raw mode, 1 Hz tick, cleanup on quit/SIGINT/SIGTERM/fatal)
- [x] Task 7: CLI command + exports + docs (`f8e5b71` — `ui` case, `./tui` export, README table)
- [x] Final review fixes (`88a48fc` — aborted runs write no activity, missing app dir exits 2, setup throw restores terminal)
