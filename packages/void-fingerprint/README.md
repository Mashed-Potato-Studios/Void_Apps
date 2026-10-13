# void-fingerprint

Stable app fingerprints for [Void Cloud](https://void.cloud/) apps: a committed manifest plus a SHA-256 hash that captures everything that defines an app's identity — routes, middleware, bindings, config, plugins, and dependencies. When anything drifts, `void-fingerprint` tells you exactly what, with evidence, and fails CI.

This is a **DX drift-detection** tool, not a secret and not an attestation. It answers "did my app change in a way I should look at?" — in code review, in CI, and across a monorepo.

- **Manifest** (`void.fingerprint.json`, committed per app): the full identity record.
- **Hash**: SHA-256 over canonical JSON, stable across machines.
- **CLI**: `emit`, `diff`, `check`, `graph` — zero runtime dependencies, Node 22.6+.
- **CI**: one Turbo task + one workflow step fails PRs on drift.
- **Plugin**: thin Vite wrapper that snapshots the manifest at build time.

## Install

```bash
pnpm add -D void-fingerprint
```

Requires `node >= 22.6`. No runtime dependencies (`vite` is an optional
peer, only needed for the build-time plugin).

## Quick start

```bash
cd apps/api

# Write the committed manifest (review the diff, commit it)
void-fingerprint emit

# Later: did anything drift?
void-fingerprint check
# apps/api: clean

# What exactly changed?
void-fingerprint diff
```

Edit a route and `check` exits non-zero; `diff` names the file, shows the
old → new hashes, and ends with `run pnpm fp:emit to regenerate`.

## How it works

### What gets fingerprinted

The scanner mirrors Void's own inference resolution order over these
directories (missing dirs are skipped, so headless services and page apps
both work):

| Dir | Contents |
|---|---|
| `routes/` | File-based API endpoints |
| `pages/` | SSR/static pages |
| `middleware/` | Middleware, in walk order |
| `crons/` | Scheduled triggers |
| `queues/` | Queue consumers |

`extraPaths` opts additional directories into the scan (default off). The
motivating case is a non-conventional directory like `apps/api/workflows/`,
which is fingerprinted via a per-app mapping (`@void-monorepo/api` maps to
`["workflows"]`).

Only `.ts, .tsx, .mts, .js, .jsx, .mjs` files are scanned (`.d.ts` skipped).
Each file contributes its path and full 64-char SHA-256 (LF-normalized, so
CRLF checkouts hash identically).

### Bindings inference

From scanned sources the tool infers:

- **specifiers**: `void/*` imports (`void/db`, `void/kv`, `void/auth`, …)
- **env access**: `env.DB` and `env["DB"]` forms (both detected)

This mirrors Void's binding table (DB / KV / STORAGE / AI / SANDBOX /
`QUEUE_*` / `VOID_LIVE` / filename-derived Durable Objects) without importing
Void itself — the CLI never touches the Vite graph.

### Manifest schema (`format: 1`)

Committed at each app root as `void.fingerprint.json`:

| Field | Content |
|---|---|
| `format` | `1` |
| `app` | Package name from `package.json` |
| `appType` | `standard` (native Void) or framework mode |
| `adapter` | Framework adapter id, or `null` |
| `target` | Deployment target from `void.json` |
| `routes` / `pages` | Sorted relative paths |
| `middleware` | Middleware files in walk order |
| `scanDirs` | Directories scanned |
| `extraPaths` | Opt-in extra directories |
| `files` | `[{ path, sha256 }]`, sorted by path |
| `bindings` | `{ specifiers, envAccess }` |
| `voidJson` | Full `void.json` snapshot — never put secrets here; it is committed verbatim |
| `plugins` | Vite plugin names in order (calls with arguments included) |
| `drizzle` | `{ schemaHash, migrationHashes }`, or `null` |
| `workspaceDeps` | `dependencies` map, ranges as-is (lockfile-tolerant) |
| `fingerprint` | SHA-256 over the canonical JSON of all of the above |

### Hash rules

- SHA-256 over canonical JSON: recursively sorted keys, `JSON.stringify`
  plus trailing LF. No timestamps, no salts, no randomness.
- Excluded: `.void/`, `dist/`, `node_modules/`, timestamps.
- `format: 1` versions the scheme; a future stricter scheme (e.g. lockfile
  hashing once a lockfile exists) bumps the version instead of silently
  changing hashes.

## CLI reference

Primary invocation is per-app from the app directory (an explicit app path
argument also works). `--all` from the repo root loops `apps/*`. Bare
`void-fingerprint` with no command runs `check`.

```
usage: void-fingerprint <emit|diff|check|graph> [app-path] [--all] [--json] [--ci] [--base <ref>] [--format mermaid]
```

Exit codes: `0` clean · `1` drift · `2` tool/usage error. Drift and crashes
are different signals on purpose — CI needs to distinguish them.

### `emit`

(Re)writes the committed `void.fingerprint.json`. Review the diff and commit
it — the committed file is the baseline everything else compares against.

```bash
void-fingerprint emit            # this app
void-fingerprint emit --all      # every app under ./apps (from repo root)
```

One writer per artifact: `emit` owns the committed manifest. The generated
copy is owned by the build plugin (below) and is never hand-edited.

### `diff`

Working tree vs committed manifest (or vs `--base <git-ref>`, e.g.
`--base origin/main` for PR review — local use only, never CI).

```bash
void-fingerprint diff
# apps/api: drift
#   routes/v1/posts.ts: a1b2c3d4 -> e5f6a7b8
#   voidJson: {...} -> {...} (void.json)
#   bindings:NEWQUEUE: null -> present (routes/v1/posts.ts:12)
# run pnpm fp:emit to regenerate
```

- Human default: one line per drifted file (`from` → `to` short hashes),
  one line per drifted config field with its source file as evidence, and
  `bindings:<TOKEN>` lines with `file:line` evidence for added/removed
  bindings — plus a regenerate footer.
- `--json`: one `{ app, ok, changed: [{ path, from, to, evidence? }], hash: { committed, computed } }`
  object per line. The full manifest is never dumped into the report.
- An app with no committed manifest yet reports everything as new
  (`isNew`) instead of crashing.
- Exits `1` on drift, `0` when clean.

### `check`

The CI command. Same drift logic as `diff`, presentation differs:

```bash
void-fingerprint check --ci
```

- `--ci`: non-TTY output (no footer, stable ordering) and strictness —
  warnings become errors, so a missing committed manifest exits `2`
  instead of printing a local "not initialized" warning.
- Drift logic is identical local vs CI by construction, so there is no
  CI-only bug class.

### `graph`

Monorepo view. Reads **committed manifests only** — never re-scans, so it is
deterministic and offline-cheap.

```bash
void-fingerprint graph --all
# wrote /repo/fingerprint.graph.json
# @void-monorepo/admin: @void-monorepo/api-client@workspace:*, @void-monorepo/db@workspace:*, …
# @void-monorepo/api: @void-monorepo/auth@workspace:*, @void-monorepo/db@workspace:*, …
```

- Writes root `fingerprint.graph.json`: per-app `{ fingerprint, deps }`
  plus a `crossApp` list marking apps whose manifests name another app's
  package.
- Prints a human table to stdout; `--format mermaid` prints a Mermaid
  diagram for README embedding instead.
- Without `--all`, prints the single app's graph node as JSON.
- A missing committed manifest is an error naming the app (`run fp:emit
  first`), not a silent re-scan.

## CI wiring (Turbo + GitHub Actions)

Three Turbo tasks, all `cache: false` (emit mutates a committed file;
check/graph are cheap to rerun):

```json
"fp:emit":  { "cache": false },
"fp:check": { "cache": false, "inputs": ["$TURBO_DEFAULT$", ".env*", "void.json", "void.fingerprint.json"] },
"fp:graph": { "cache": false, "dependsOn": ["fp:check"] }
```

`fp:check` is a pure source scan with no build dependencies; `fp:graph`
depends on `fp:check` so the root graph never builds on stale manifests.
Each app exposes `fp:emit` / `fp:check` / `fp:graph` scripts that shell out
to the binary (never inline logic), and the root has `fp:check:all`.

In `deploy.yml`, the `validate` job checks out with `fetch-depth: 0` and
runs `pnpm run fp:check:all` **after build** (the binary runs from `dist/`,
so the package must be built first). Drift fails `validate`, so `deploy`
never runs on a drifted tree. `--base origin/main` stays a local review
convenience and is never wired into CI — the committed-file default already
blocks the merge.

## Vite plugin

Thin wrapper for build-time snapshots. Spread it **after** `voidPlugin()`:

```ts
import { voidPlugin } from "void";
import { fingerprintPlugin } from "void-fingerprint";

export default defineConfig({
  plugins: [voidPlugin(), fingerprintPlugin()],
});
```

- `buildStart` infers, `writeBundle` writes `<app>/.void/fingerprint.json`
  (the generated copy — it rides the existing build outputs into deploy).
- `apply: "build"` + `enforce: "post"`: it never runs in dev and never
  fights the toolchain. Dev emits nothing by default.
- The plugin reads the Vite `root` via `configResolved` (override with
  `fingerprintPlugin({ root })`) and shares the CLI's per-app `extraPaths`
  mapping, so CLI and plugin snapshots agree.
- The plugin is pure library calls; all logic lives in the package, so the
  CLI and the plugin can never disagree.

## Library API

```ts
import {
  buildManifest, emitManifest,   // manifest + committed file
  diffManifest, checkFingerprint, // drift vs baseline (or --base ref via { baseRef })
  buildGraph, writeGraph,        // monorepo graph from committed manifests
  fingerprintPlugin,             // thin Vite wrapper
  canonical, sha256Hex, hashFile, // canonical JSON + hashing primitives
} from "void-fingerprint";
```

## Monorepo dogfood

This package is developed inside a monorepo that uses it on itself:
`apps/{web,api,admin}/void.fingerprint.json` are committed, `fingerprint.graph.json`
sits at the root, and CI checks them. The `api` app exercises the
`extraPaths` path (`workflows/`), and the graph surfaces the shared-database
edge (`@void-monorepo/db` touches all three apps).

## Releasing

This is the only publishable package in the monorepo; everything else
stays `private`. Changes are tracked in `CHANGELOG.md` (Keep a Changelog,
SemVer).

```bash
cd packages/void-fingerprint

# 1. Move Unreleased entries under a new version heading in CHANGELOG.md
# 2. Bump (runs build + tests via preversion):
npm version patch  # or minor / major
git push --follow-tags

# 3. Publish (tag void-fingerprint-v* triggers CI publish with provenance):
git tag void-fingerprint-v$(node -p "require('./package.json').version")
git push origin void-fingerprint-v$(node -p "require('./package.json').version")

# Dry-run anytime:
pnpm run release:dry
```

CI verifies the tag matches `package.json`, runs build/typecheck/tests,
publishes with `--provenance`, and opens a GitHub release.

### npm auth: tokens vs trusted publishing

npm retired classic tokens — use one of these:

- **First publish:** create a **granular access token** at
  `npmjs.com → Access Tokens` scoped to this package (or short-lived
  just for the first release), with **publish** permission. Save it as
  the `NPM_TOKEN` repo secret. This claims the (currently free) name.
- **After that (recommended):** switch to **trusted publishing** and
  delete the secret. In the package's `npmjs.com → Settings → Trusted
  Publisher`, add this repo + the `release.yml` workflow. The workflow
  already requests `id-token: write` and publishes with `--provenance`,
  so no token is needed once the trusted publisher is configured.
  Remove `NODE_AUTH_TOKEN` from the workflow at that point.

Requires 2FA on the npm account regardless; automation/granular tokens
and OIDC both satisfy CI publishing without interactive 2FA.

## Known limits

- The binding regex covers `from "void/…"` imports plus `env.X` /
  `env["X"]` access. Side-effect imports (`import "void/db"`), dynamic
  `import()`, and `require()` are not traced; neither are re-export chains.
  Regex-based, not AST-based — matches Void's documented patterns, not an
  arbitrary module graph.
- `appType`/`adapter` assume standard native-Void mode; framework-mode
  detection follows Void's own `package.json`-dep heuristics in a later
  version.
- Line-level evidence is reported for binding tokens; file-content drift
  carries the file path (a hash can't name a line, and this tool won't
  fabricate one).
- Scanner grammar details (regex vs AST upstream), SSR-entry patterns, and
  per-framework scan-dir variance are tracked against `void prepare` output
  at build time.

## License

MIT.
