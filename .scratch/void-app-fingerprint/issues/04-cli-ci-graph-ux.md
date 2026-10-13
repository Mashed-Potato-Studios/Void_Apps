# CLI, CI check, and monorepo graph UX

Type: grilling
Status: resolved
Blocked by: 03

## Question

HITL grilling. Decide CLI/CI UX once [Manifest schema and hash rules](03-manifest-schema-and-hash.md) is closed. Settle: commands (`emit`, `diff`, `check --ci`, `graph`), inputs (against committed file vs deploy vs git ref), outputs (human + JSON), exit codes for CI failure on drift, Turbo task wiring (`turbo.json`), GitHub Actions step in `.github/workflows/deploy.yml`, `vp run` interplay, per-app vs workspace-root invocation in pnpm monorepo. Resolves through live exchange.

## Comments

## Answer

Resolved 2026-10-13 (GitHub #6, closed). All accepted: (1) emit/diff/check --ci/graph, committed manifests as baseline; (2) source-only fingerprint:check in validate pre-build, .void/ copies via existing outputs; (3) standalone node binary, pnpm filter + Turbo, vp run deferred.
