# void-fingerprint — Spec (from wayfinder map)

Source: wayfinder map [Void app fingerprint](https://github.com/titan-65/Void_Apps/issues/1) (closed 2026-10-13, 6/6 tickets). This doc consolidates ticket answers; tickets hold detail.

## Goal

New OSS DX package delivering a stable app Fingerprint for Void apps: manifest + hash + CLI, dogfooded in this monorepo (`apps/web`, `apps/api`, `apps/admin`), publishable to npm. Drift detection for DX, not secret, not attestation.

Non-goals (map Out of scope): runtime app-to-app signing, deploy provenance audit, `vp run` integration day one.

## Package

- Name `void-fingerprint`, MIT, public. Version `0.1.0`. Workspace-linked internally (`workspace:*` consumers).
- `packages/void-fingerprint/`: pure lib (`emitManifest`, `diff`, `check`, `graph`) + thin Vite plugin + standalone `bin/void-fingerprint.mjs` (node shebang, zero Vite import, zero runtime deps). Sibling package — not inside `flow` (runtime workflow engine, different domain).
- Engines: `node >= 22` (type-stripping runs TS bin/lib without a loader).
- Build: `tsc` to `dist/` (types included); `exports` point at `dist`; `files: [dist, bin]`; `prepublishOnly` builds. Internal use resolves `dist` via Turbo `^build` ordering.
- Erasable TS only (no enums/namespaces) so `node --test` runs sources directly.

## Manifest schema (`format: 1`)

Per app, committed at app root as `void.fingerprint.json`:

| Field | Content |
|---|---|
| `format` | `1` |
| `app` | package name (e.g. `@void-monorepo/api`) |
| `appType` | `standard` (native Void) or framework mode name |
| `adapter` | framework adapter id or `null` (none in this repo) |
| `target` | from `void.json` (`cloudflare` here) |
| `routes` / `pages` | sorted relative paths under `routes/`, `pages/` |
| `middleware` | middleware files in plugin/order encountered |
| `scanDirs` | dirs scanned (standard defaults) |
| `extraPaths` | opt-in extra dirs, default off (covers `apps/api/workflows/` outlier) |
| `files` | `[{path, sha256}]` full 64-char hex, sorted by path |
| `bindings` | `{specifiers: [...], envAccess: [...]}` inferred imports + `env.*` |
| `voidJson` | full `void.json` snapshot |
| `plugins` | vite plugin list (names in order; `voidPlugin()` position recorded) |
| `drizzle` | `{schemaHash, migrationHashes[]}` or `null` when app touches no local migrations |
| `workspaceDeps` | `dependencies` map from app `package.json` (ranges as-is) |
| `fingerprint` | SHA-256 over canonical JSON of all above |

## Hash rules

- SHA-256 over canonical JSON: recursively sorted keys, `JSON.stringify` + LF, no timestamps/salts.
- Excludes: `.void/`, `dist/`, `node_modules/`, timestamps.
- Lockfile-tolerant: hash `package.json` ranges today; upgrade to lockfile hash once a lockfile is committed (no format break — `format` stays `1` until schema changes).

## Scanner reuse (from scanner-internals ticket)

Mirror Void resolution order, same extensions (`.ts,.tsx,.mts,.js,.jsx,.mjs`) + `.server.ts`-companion rule, same `void/*` specifier + `env.*` patterns, then `inference.bindings` overrides; verify against `void prepare` output at build. Known caveats: scanner grammar (regex vs AST), SSR-entry patterns, per-framework variance, `void.json` → `void.config.ts` migration.

Local ground truth (inventory ticket): standard native-Void mode, bare `voidPlugin()` ×3, legacy `void.json` (no `inference` keys), zero live `void/*` imports, no `src/`/`durable-objects/`/`db/`/`email/`/`void.config.ts`/`.void/`; shared `packages/db` touches all apps; no lockfile/migrations in repo.

## Artifacts

- Committed per app: `apps/*/void.fingerprint.json` (reviewable diff, CI baseline).
- Generated at build: `.void/fingerprint.json` per app (copy, feeds deploy; rides existing `build` outputs).
- Root graph: `fingerprint.graph.json` (per-app nodes + shared-dep edges, e.g. db-touches-all).

## CLI

Bare `void-fingerprint` = `check`. Primary invocation is per-app from cwd (optional app path argument, defaults to cwd); `--all` from the repo root is sugar that loops `apps/*` via a thin root script. Apps carry scripts `fp:emit` / `fp:check` / `fp:graph`, root mirrors `fp:check:all` — every script shells out to the binary, never inlines logic (a later vite-plus mapping renames nothing).

Baseline = committed `void.fingerprint.json`. Optional `--base <git-ref>` compares the working tree against the fingerprint committed at that ref (PR drift vs main) — opt-in, local/PR-review only, never in CI.

- `emit`: rewrites committed manifests; per app or `--all`.
- `diff`: working tree vs committed (or `--base` ref); human default, `--json` for machines; exit 0 when clean.
- `check` / `check --ci`: exit `0` clean, `1` drift, `2` tool/usage error (CI needs drift ≠ crash). `--all` exits 1 if any app drifts and prints per-app sections. `--ci` is presentation + strictness only: non-TTY output (no color, no footer, stable line ordering), warnings promoted to errors (missing committed manifest = exit 2). Drift logic is identical local vs CI.

Human drift report: compact table, one line per drifted field with evidence — `bindings: +KV (apps/api/routes/x.ts:12)` — plus footer `run pnpm fp:emit to regenerate`. `--json` emits `{app, ok, changed:[{path, from, to, evidence?}], hash:{committed, computed}}`; the full manifest is never dumped into the report.

`graph` (root-only): reads committed manifests only, never re-scans (deterministic, offline-cheap). Edges: app → consumed workspace package (name + range), plus `crossApp` marker when one app's manifest lists another app's package (`api-client` consumed by web/admin). Outputs human table to stdout + root `fingerprint.graph.json`; `--format mermaid` escape hatch for README embedding.

## Plugin (thin wrapper)

`fingerprintPlugin()` placed after `voidPlugin()`; `buildStart` infers, `writeBundle` writes `.void/fingerprint.json`; dev gated behind `FINGERPRINT_DEV=1`; never fights the toolchain. `vp run` mapping deferred.

## CI wiring

Turbo tasks (all `cache: false` — emit mutates a committed file, check/graph are cheap to rerun):

```json
"fp:emit":  { "cache": false },
"fp:check": { "cache": false, "inputs": ["$TURBO_DEFAULT$", ".env*", "void.json", "void.fingerprint.json"] },
"fp:graph": { "cache": false, "dependsOn": ["fp:check"] }
```

`fp:check` has no build `dependsOn` — the emitter is a pure lib scanning source. `fp:graph` depends on `fp:check` so the root graph never builds on stale app manifests.

- `validate` job: checkout with `fetch-depth: 0` (full history), then `pnpm run fp:check:all` after build; fails PRs on drift.
- `deploy` job unchanged except `.void/` copies ride existing build outputs.
- `--base origin/main` is never wired into CI — the committed-file default already blocks the merge. No PR-comment bot (scope creep).

## Acceptance

1. `pnpm --filter @void-monorepo/api fp:emit` writes `apps/api/void.fingerprint.json` with `format: 1` + 64-char `fingerprint`.
2. Editing a route then `check --ci` exits 1; `diff` names the file with `file:line` evidence.
3. Clean tree: `check --ci` exits 0; malformed config exits 2.
4. Root `fp:graph` writes `fingerprint.graph.json` showing db edge to all three apps.
5. `turbo run fp:check` passes; PR with drift fails `validate`.
6. `pnpm publish` dry-run of `packages/void-fingerprint` contains only `dist/` + `bin/`.
