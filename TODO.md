## Todo

TUI for void-crons — spec: `docs/superpowers/specs/crons-tui.md`, plan: `docs/superpowers/plans/2026-10-20-void-crons-tui.md`.



Constraints: zero new runtime deps, single app only (`--json`/`--all` rejected), toggles session-only (only `emit` persists), terminal always restored, tests need no pty.

## Doing

## Done

- [x] Task 1: State model and reducer (`2402570` — `TuiState`, `Msg`, `reduce()`, `createState`)
- [x] Task 2: Width-safe renderer (`0a337bb` — `src/tui/render.ts`, pure, width-aware, `NO_COLOR` clean)
- [x] Task 3: Snapshot loader (`74040f7` — `src/tui/data.ts`, scan + manifest/drift + activity + nextFire)
- [x] Task 4: Key mapping (`6ed778f` — `src/tui/keys.ts`, keypress to `Msg`)
- [x] Task 5: Abort plumbing (`14b62e7` — `signal` through trigger + `runScheduleOnce`, never retries on abort)
- [x] Task 6: Terminal runner (`08c715a` — `src/tui/run.ts`, raw mode, 1 Hz tick, cleanup on quit/SIGINT/SIGTERM/fatal)
- [x] Task 7: CLI command + exports + docs (`f8e5b71` — `ui` case, `./tui` export, README table)
- [x] Final review fixes (`88a48fc` — aborted runs write no activity, missing app dir exits 2, setup throw restores terminal)
