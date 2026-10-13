# Vite+ and voidPlugin hook points

Type: research
Status: resolved
Blocked by:

## Question

Where can a fingerprint emitter hook in without fighting the toolchain? Resolve: `voidPlugin()` role in `vite.config.ts` (dev/build inference timing), Vite+ `vp` commands (`dev, build, check, test, run, pack`) and config file surface, plugin ordering with framework adapters (`@void/react/plugin` etc.), where to emit on `dev/build` vs standalone CLI, what `vite preview` / `dist/ssr/app.js` exposes, Node-target (`target: node`) differences (no `void deploy`, no prerender). Recommend thin-wrapper integration shape; flag anything requiring upstream changes.

## Comments

- Research probe returned (chart session, ticket still open): voidPlugin/vp hook findings with citations; raw notes at /tmp/void-fingerprint-viteplus-hooks/notes.md (git unavailable, no branch). Key deltas: bare voidPlugin() in all 3 apps, no vite-plus dep yet (vite ^6, plain scripts); recommended thin-wrapper shape = pure emitManifest lib + fingerprintPlugin after voidPlugin, buildStart infer + writeBundle write, dev gated FINGERPRINT_DEV=1, run.tasks for CI. Upstream asks: exportable inference scanner API, .void/ contract, void.json migration. See subagent result in chart session before claiming.

## Answer

Resolved 2026-10-13 (GitHub #3, closed). Verified: voidPlugin array/options, vp built-in + run-task surface, adapter ordering, node-target bans, artifact outputs — per docs. Local: bare voidPlugin() x3, no vite-plus (vite 6, plain scripts), void ^0.1.0, legacy void.json cloudflare-only; turbo build -> dist/** + .void/**, void:deploy after build. Shape: pure emitManifest lib + thin plugin after voidPlugin, buildStart/writeBundle, dev gated; Turbo tasks for CI. Upstream: Void scanner API + .void/ contract + void.json migration; Vite+ nothing.
