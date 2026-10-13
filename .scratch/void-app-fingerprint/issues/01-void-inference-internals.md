# Void inference scanner internals

Type: research
Status: open
Blocked by:

## Question

What exactly does Void's resource inference scan, and how can a fingerprint tool reuse it without forking logic? Resolve: default scan dirs per mode (standard vs framework), always-scanned entries (SSR entry, `durable-objects/`), file types (`.ts,.tsx,.mts,.js,.jsx,.mjs`, Astro frontmatter; Vue/Svelte not scanned directly — where do their `.server.ts` companions fit), detected import specifiers (`void/db,kv,storage,ai,sandbox,queues,live`, `void/auth`, `void/client*`, `env.*` access patterns), binding table (DB/KV/STORAGE/AI/SANDBOX/QUEUE_*/VOID_LIVE/filename-derived DO), `inference.scanDirs` / `inference.bindings` overrides, `sourceDir` behavior, framework detection via `package.json` deps. Cite Void docs pages + local Void/Vite plugin source if resolvable. Record what is confirmed vs assumed.

## Comments

- Research probe returned (chart session, ticket still open): full scan-dir/binding/override findings with doc + local citations; raw notes at /tmp/void-inference/notes.md (git unavailable, no branch). Key deltas for schema work: repo uses legacy void.json (canonical is now void.config.ts + void.lock.json); zero live void/* imports; standard mode; open unknowns = scanner grammar (regex vs AST, re-export tracing, env["DB"] forms), SSR-entry patterns, per-framework scanDir variance. See subagent result in chart session before claiming.
