## Destination

Spec for new OSS DX package delivering stable app Fingerprint for Void apps — manifest + hash + CLI (`emit`, `diff`, `check --ci`, `graph`), dogfooded in this monorepo (`apps/web,api,admin`), ready to hand to planning/build. Nothing built on this map; decisions only.

## Notes

- Domain: Void Cloud (Vite plugin + backend SDK + platform), Vite+ (`vp` toolchain). Canonical terms: **Fingerprint** = stable hash + manifest derived from app source for DX drift detection (not secret); **Signature** = cryptographic attestation (out of scope); **Manifest** = full app identity record (app type, framework adapter, routes/pages, middleware order, void.json, inferred bindings, Drizzle schema + migration hashes, plugin list, deps).
- Skills every session should consult: `grilling`, `domain-modeling` (per map Notes). `brainstorming` context carried: path C (DX fingerprint) chosen; A (runtime auth) and B (provenance audit) out.
- Standing preferences: terse caveman comms; code/commits/security prose written normal; refer to tickets by name, never bare numbers.
- Testbed: `apps/web`, `apps/api`, `apps/admin` + `packages/flow`, `packages/db,auth,ui,api-client,types,config`. `void.json` per app, `voidPlugin()` in `vite.config.ts`, Turbo + pnpm workspaces, `.github/workflows/deploy.yml` (`void deploy`).
- Source facts: Void scans `routes/,middleware/,queues/,pages/,crons/,email/,src/` (standard) or `src/,app/,routes/,server/,pages/,crons/,queues/` (framework mode), always SSR entry + `durable-objects/`; imports `void/db,kv,storage,ai,sandbox,queues,live`, `void/auth`, `void/client*`; bindings DB/KV/STORAGE/AI/SANDBOX/QUEUE_*/VOID_LIVE/filename-derived Durable Objects.

## Decisions so far

- [Void inference scanner internals](https://github.com/titan-65/Void_Apps/issues/2): reuse Void resolution order + specifier/env table; repo standard-mode, legacy void.json, zero live void imports; grammar + migration caveats into #5/#7.
- [Vite+ and voidPlugin hook points](https://github.com/titan-65/Void_Apps/issues/3): pure-lib emitter + thin plugin after voidPlugin(), buildStart/writeBundle, dev gated; Turbo tasks for CI; no vite-plus in repo yet, no upstream Vite+ changes.
- [Monorepo app and resource inventory](https://github.com/titan-65/Void_Apps/issues/4): web/api/admin shapes recorded, db touches all apps, no lockfile/migrations/node_modules; workflows/ dir + lockfile policy open into #5.
- [Manifest schema and hash rules](https://github.com/titan-65/Void_Apps/issues/5): full manifest + extra-paths; SHA-256 canonical JSON format v1; committed manifest + generated copy + root graph; void-fingerprint MIT.
- [CLI, CI check, and monorepo graph UX](https://github.com/titan-65/Void_Apps/issues/6): emit/diff/check --ci/graph; per-app cwd primary + `--all` sugar; committed-manifest baseline + opt-in `--base <ref>`; exit 0/1/2 (clean/drift/tool error); report = per-field delta w/ file:line evidence, `--json` schema; one writer per artifact (emit→committed, plugin writeBundle→`.void/`); graph reads committed manifests only, app→pkg + crossApp edges, mermaid escape hatch; `--ci` = non-TTY + warnings→errors; Turbo `fp:emit/fp:check/fp:graph` all `cache:false`, graph dependsOn check; CI = `fetch-depth:0` + `pnpm run fp:check:all` in validate; scripts `fp:*` shell out to binary; `vp run` deferred.
- [Fingerprint emitter prototype spike](https://github.com/titan-65/Void_Apps/issues/7): probe validated schema/hash on apps/api (8 files, empty bindings); keep shape, kill probe after map closes.

## Not yet specified

- Reuse depth of Void inference internals vs standalone parser; handling of Vue/Svelte files (not directly scanned by Void) and Astro frontmatter.
- Publish pipeline detail (dry-run acceptance exists; registry, provenance, release notes); upstream contribution posture toward Void/Vite+.

## Out of scope

- Runtime app-to-app request signing / spoof prevention (option A) — hangs off fingerprint later, not this destination.
- Deploy provenance audit / code attestation linking deploy to worker version (option B) — same, later.
- Building the package or prototype as deliverable — map produces decisions; execution hands off after.
