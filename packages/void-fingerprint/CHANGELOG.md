# Changelog

All notable changes to `void-fingerprint` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).
Only this package is versioned — the rest of the monorepo stays `private`.

## [Unreleased]

## [0.1.0] - 2026-10-13

Initial public release: manifest + hash + CLI + Vite plugin + monorepo graph.

### Added

- `buildManifest` / `emitManifest`: full app identity record (`format: 1`)
  with file hashes, bindings inference, `void.json` snapshot, plugins,
  workspace deps, and SHA-256 fingerprint over canonical JSON.
- CLI (`void-fingerprint`): `emit`, `diff`, `check`, `graph`, `--all`,
  `--json`, `--ci`, `--base <ref>`, `--format mermaid`. Exit codes
  `0` clean · `1` drift · `2` tool error.
- `checkFingerprint` / `checkDiffResult`: single-scan drift check for CI.
- `fingerprintPlugin`: build-time snapshot to `.void/fingerprint.json`,
  Vite `root`-aware, shares the CLI's per-app `extraPaths` mapping.
- `buildGraph` / `writeGraph`: monorepo view from committed manifests.
- `optsForApp`: one shared per-app mapping for CLI and plugin.
- Tests: 26 passing (happy paths + hardening: CRLF/CR hashing,
  symlink-cycle safety, format/corrupt baselines, `extraPaths`
  attribution, plugin/CLI parity).

### Fixed

- Shipped `.d.ts` used `.ts` specifiers (unresolvable for consumers).
  Sources now use NodeNext `.js` specifiers; build asserts clean output.
- `check` scanned the tree twice (TOCTOU); now diffs once.
- Drift attribution covered only 5 manifest fields; now covers `appType`,
  `adapter`, `routes`/`pages`/`middleware`, `scanDirs`, `extraPaths`,
  `drizzle`.
- Hand-edited or future-`format` baselines degraded silently; now throws
  with a re-run hint.
- Plugin and CLI disagreed on `extraPaths` and `process.cwd()`;
  now share `optsForApp` and resolve the Vite root.
- `walk` followed symlinks (cycle/escape risk); now skips symlinked dirs
  and drops entries escaping the app root.
- `hashFile` normalized only `\r\n`; now normalizes lone `\r` too.
- `void/` binding evidence matched substrings (`avoid/db`); now anchored.
- `--all` app order was OS-dependent; now sorted.
- Strict `noUncheckedIndexedAccess` fallout fixed across src and tests.

### Security

- Only file hashes (never contents) and env-var names (never values)
  enter the manifest. `void.json` is snapshotted verbatim — never put
  secrets in it.
