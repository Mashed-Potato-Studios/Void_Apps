# CLI, CI check, and monorepo graph UX

Type: grilling
Status: resolved
Blocked by: 03

## Question

HITL grilling. Decide CLI/CI UX once [Manifest schema and hash rules](03-manifest-schema-and-hash.md) is closed. Settle: commands (`emit`, `diff`, `check --ci`, `graph`), inputs (against committed file vs deploy vs git ref), outputs (human + JSON), exit codes for CI failure on drift, Turbo task wiring (`turbo.json`), GitHub Actions step in `.github/workflows/deploy.yml`, `vp run` interplay, per-app vs workspace-root invocation in pnpm monorepo. Resolves through live exchange.

## Comments

## Answer

Resolved 2026-10-13 (GitHub #6, closed), two grilling rounds, ten decisions:

1. **Invocation**: per-app cwd primary (optional app path, defaults to cwd); `--all` from root is sugar looping apps. Implementation lives in new sibling `packages/void-fingerprint` (name `void-fingerprint`), NOT in `flow` (runtime engine, different domain). Root graph built by a thin root script joining per-app manifests. Apps get `fp:emit`/`fp:check` scripts.
2. **Artifact writers**: `emit` writes committed `void.fingerprint.json` only; plugin `writeBundle` writes generated `.void/fingerprint.json`. One writer per artifact — generated copy is never hand-editable.
3. **Baseline**: committed manifest by default (works in any clone); `--base <git-ref>` opt-in compares working tree against fingerprint at that ref (PR drift vs main). Deploy-artifact baseline out of scope.
4. **Exit codes**: `0` clean, `1` drift, `2` tool/usage error. `--all` fails the whole run if any app drifts; report prints per-app sections so you see which of web/api/admin drifted.
5. **Output**: human default = compact table, one line per drifted field with evidence (`file:line`), plus `run pnpm fp:emit to regenerate` footer. `--json` = `{app, ok, changed:[{path, from, to, evidence?}], hash:{committed, computed}}`. Never dumps the full manifest — manifest is the artifact, report is the delta.
6. **Turbo**: tasks `fp:emit`/`fp:check`/`fp:graph`, all `cache: false` (emit mutates a committed file; check/graph are cheap). `fp:check` inputs `["$TURBO_DEFAULT$", ".env*", "void.json", "void.fingerprint.json"]`; `fp:graph` `dependsOn: ["fp:check"]` so root graph never builds on stale app manifests. No build `dependsOn` — emitter is a pure lib scanning source.
7. **GitHub Actions**: `validate` job checkout gets `fetch-depth: 0` (full history); one step after build, `pnpm run fp:check:all`. Drift fails `validate`, so `deploy` never runs. `--base origin/main` stays a local/PR-review convenience, never wired into CI; no PR-comment bot.
8. **Script naming**: `fp:emit`/`fp:check`/`fp:graph` in each app + root mirrors (`fp:check:all`). All shell out to the `void-fingerprint` binary, never inline logic, so a later vite-plus mapping renames nothing. No script for `FINGERPRINT_DEV=1` — dev emits nothing by default.
9. **Graph**: root-only, reads committed manifests only (never re-scans — deterministic, offline-cheap). Edges: app → consumed workspace package (name + version range) plus `crossApp` marker when one app's manifest lists another app's package (`api-client` consumed by web/admin is the real case). Output both: human table to stdout + root `fingerprint.graph.json`; `--format mermaid` escape hatch for README embedding.
10. **`--ci` and bare invocation**: bare `void-fingerprint` = `check`. `--ci` is presentation + strictness only — non-TTY output (no color, no footer, stable line ordering), warnings promoted to errors (missing committed manifest = exit 2 under `--ci` vs "not initialized" warning locally). `--json` orthogonal. Drift logic identical local vs CI, so no CI-only bug class.
