# Void crons: platform integration research

Researched **2026-10-22** against live official documentation and the locally installed **`void@1.1.11`**, resolved through `apps/coffee-api/node_modules/void`. This is not a claim that 1.1.11 is the latest published package. Read-only SDK/implementation inspection; no deployments, remote triggers, credential reads, or implementation changes. Existing user edits are outside this research's scope. Only the root `AGENTS.md` applies; no additional instructions were found under `docs/`.

## Confirmed contracts

### Scheduled jobs and trigger boundaries

- Discovery: `crons/**/*.{ts,mts,js,mjs}`; files/directories beginning `_` are ignored. Each job exports `cron` as a string or string array and a default handler. `defineScheduled` is recommended, not a scheduler or instrumentation wrapper: installed implementation is an identity function. Its signature is `(controller: ScheduledController, env: CloudEnv["Bindings"], ctx: ExecutionContext) => unknown | Promise<unknown>`. No SDK-defined per-job result/metrics schema is promised. [1, S1]
- Dispatch selects **all jobs with an exact matching expression**, waits for them, and aggregates failures. Installed framework generation uses `Promise.allSettled` and throws `AggregateError`; native development generation also waits for every matching job. A selected filename is not part of the HTTP contract. A success response cannot identify which individual handler did what; a shared-expression failure can occur after other handlers succeeded. [1, S2, S3]
- Local schedules do **not** fire automatically. Supported manual contract: `POST /__void/scheduled`, `Content-Type: application/json`, `x-void-dev-trigger: <dev-token>`, body `{ "cron": "<exported-expression>", "scheduledTime": <unix-ms> }`; success `{ "ok": true }`. Framework dispatch uses adapter-provided bindings. Installed SDK writes the development token to `.void/dev-trigger-token`; treat that file as a local credential, not manifest data. [1, S3]
- Production distinction is essential: native scheduled events need no manual HTTP token. Official docs describe framework HTTP dispatch using `x-void-internal`, authenticated by the managed platform proxy token or explicitly configured `CRON_SECRET`. Installed framework code chooses `env.__VOID_PROXY_TOKEN || env.CRON_SECRET`, so `CRON_SECRET` is **fallback**, not an additional accepted token when the proxy token exists. Missing/mismatched auth returns 401. [1, S2]
- Installed native generation also contains an internal HTTP route, but its authorization uses a proxy token/build-key path, **not** the framework `CRON_SECRET` fallback. This implementation detail is not evidence of a supported public production remote-trigger facility. Do not infer public reachability, operator credentials, authorization, or an app-specific endpoint from a dev URL or the existence of generated code. [S3]
- Void platforms allow 100 distinct expressions and 1,000 schedules per project; each expression exported by each job contributes a schedule. Direct Cloudflare deployments have their own limits. These are target-specific, not universal limits of `packages/crons`. [1]

### Queues: split scheduling from work completion

- `queues/**/*.{ts,mts,js,mjs}` default-exports `defineQueue<Message>(async (batch, env) => ...)`. Paths become names (`order/notifications.ts` → `order-notifications`), which must be unique and satisfy the documented 1–63-character naming rules. `import { queues } from 'void/queues'` exposes typed producers, e.g. `await queues.emails.send(body)`. Installed `QueueMap` is augmented by generated `.void/queues.d.ts`; an unprepared checkout does not have the full producer type contract. [2, S4]
- Messages expose `id`, `body`, `attempts`, `timestamp: Date`, `ack()`, and `retry({ delaySeconds }?)`; batches expose `ackAll()`/`retryAll()`. First decision wins. Undecided messages are acknowledged on successful handler completion and retried on throw. Consumer exports `maxBatchSize`, `maxBatchTimeout`, `maxRetries`, `retryDelay` default to **10 / 5 seconds / 3 / 0 seconds**. Void-managed queues do not configure a dead-letter queue; exhausted messages are deleted without one. [2]
- Native local binding sends invoke consumers automatically in Miniflare. Meta-framework development binding sends do not: use authenticated `POST /__void/queue` with `{ queue, messages: [{ id, timestamp: <unix-ms>, body, attempts }] }`. Sending/enqueueing and completing downstream work are separate operations, with separate retry/failure outcomes. [2]

### Durable state: coordination and authoritative operation state

- Native apps can default-export `defineDurableState` from `void/durable` in `durable-objects/`. `Definition.get('instance-name')` resolves the same SQLite-backed Durable Object for that name; methods are typed and execute one at a time. Context provides `state`, `env`, `id`, `storage`, `setAlarm`, `deleteAlarm`; `fetch` and `alarm` are top-level hooks, not RPC method names. [3]
- Successful method/fetch/alarm completion saves `context.state`; handler/save failure restores its previous value. Direct `context.storage` writes are excluded from that rollback. This is **not** a transaction over external queue sends, network calls, or published events. State migrations are contiguous versions starting at 1. [3]
- Supported on Void platforms and direct Cloudflare native apps, **not** custom Durable Object modules in meta-frameworks or Node/Bun/Deno. Keep resource names, instance names, and `void.lock.json` migration history stable. On Void platforms, code rollback keeps current data; removed classes retain storage and count toward the 32-class project limit. Direct Cloudflare class-lifecycle changes require the documented atomic deployment flow and cannot be rolled back across that migration boundary. [3]

### Live event streams: notification, not the activity database

- `defineLiveStream` from `void/live` supports publishing from scheduled handlers and queue consumers. Routes expose `GET => live.connect(c)` and `POST => live.control(c)`; browser `connectLiveStream` from `void/live/client` multiplexes topic subscriptions over one SSE connection. Server contract: `await live.publish(topic, data, { type, eventId })`; outside active runtime context, `live.withEnv(env).publish(...)`. Installed types confirm `publish(): Promise<void>` and `withEnv(env): Pick<LiveStream, "publish">`. [4, S5]
- Events are ordered within a topic, **at most once**, and not stored. Deploy/rollback/reconnect can lose live state/events. Browser helper restores subscriptions and sends latest `eventId` as `lastEventId`, but Void does not replay history or interpret those IDs; IDs are not native SSE `id` fields. [4]
- Ownership protects subscription control, not topic access. Without `onSubscribe`, every accepted connection can read any topic; `allowAnonymousControl: true` makes that especially unsafe for operations data. Implement explicit topic authorization. Default caps: 256 subscriptions/connection, 256 subscriptions/topic (cannot increase), 100 control operations/request, 100 queued events/connection, 64 KiB encoded event envelope. [4]

### Environment, inference, deployment, and logs

- `env.ts` + `defineEnv` and typed `env` from `void/env` validate configuration. Root `.env` plus shell values serve local tools; shell wins. Other dotenv variants and `.dev.vars*` are unsupported. `__VOID_*` names are reserved. Production server keys must be remote secrets (`void secret put`/`sync`); deploy does not upload `.env`. `VITE_*` values are public build inputs, not secrets. `void env check`, `void env check --remote`, and `void env types` cover different checks/generation. [5]
- Inference scans application directories, including `crons/`, `queues/`, and `src/`; `durable-objects/` is specially scanned for native definitions. `void/queues` implies `QUEUE_*`, `void/live` implies `VOID_LIVE`, and durable definitions imply filename-derived bindings. Static binding access is recognized; runtime-selected keys may require explicit overrides. `inference.scanDirs` replaces defaults (with documented always-scanned exceptions), so a shared helper hidden in an unscanned workspace/package is not proven to activate resources. [6]
- Deploy builds, provisions resources, applies migrations, then publishes. Commit generated `void.config.ts`/`void.lock.json`, match CLI/framework-adapter versions, and run `void prepare` before CI typechecking when generated types are needed. SQL migrations are not undone by code rollback; neither is durable state. Each platform has separate projects/secrets/data. [3, 7]
- Project operator logs: `void project logs [--level ...] [--filter ...] [--range ...] [--deployment ...]`; Void platforms retain history, direct Cloudflare uses live tail, not history. Caught-and-only-persisted errors do not appear automatically: log the `Error` object to preserve stack detail. Logs are diagnostic evidence, not a structured per-job completion ledger. [8]
- Administrator-only path: `void platform deployment logs <id> [--since <time>] [--cursor <cursor>] [--limit <n>] [--follow]`. Defaults: last hour, oldest first, 100 records; limit 1–500, continue with `nextCursor`. Follow checks every two seconds with a five-minute delayed-record overlap and duplicate suppression; windows over 10,000 records error. Do not silently substitute administrator access for project-operator access. [9]

## Recommendations — not existing SDK guarantees

### P0 — make execution claims truthful and safe

1. **Separate capabilities by runtime and target.** Distinguish local manual dispatch, platform-managed scheduling, framework-authenticated HTTP dispatch, and any explicitly implemented application trigger. Production manual triggering should remain unavailable/unknown until verified for the actual deployment. Never request or expose `__VOID_*` platform credentials. [1, 5, S2, S3]
2. **Model expression invocations separately from job runs.** One HTTP call can run several jobs; retries after timeouts or partial failure can repeat successful side effects. Show expression-wide dispatch scope before triggering; do not label aggregate HTTP success as independently observed per-file success. Add handler-level correlation/instrumentation and idempotency before promising safe retries. No inspected contract supplies cron exactly-once execution or an idempotency key. [1, S2, S3]
3. **Preserve credential boundaries.** Treat the development token file as secret; validate URL origin/target explicitly before attaching credentials rather than identifying localhost with substring matching. Keep diagnostics redacted and production secrets out of generated manifests/client bundles. This is a recommendation informed by the current `packages/crons/src/trigger.ts` origin/header path, not an implementation audit or patch. [5, S3, R1]

### P1 — integrate execution, persistence, and realtime

4. **Use cron → typed queue → consumer for expensive work.** Carry application-defined `runId`, `jobName`, scheduled timestamp, attempt identity, and idempotency key in messages. Record “dispatched/enqueued” separately from consumer completion; queue retries are not cron retries. Persist terminal/exhaustion evidence explicitly, since no automatic DLQ is configured. [1, 2]
5. **Offer durable coordination as a native-only adapter.** A stable per-project/job instance could serialize claims, leases, and transitions; alarms could expire leases. Do not hold one serialized RPC through an entire long job. Keep external effects idempotent, and use an outbox/reconciliation design if persisted state must agree with queue publishing. Retain the local store for offline/dev and a different persistence adapter for frameworks. None of these application protocols is provided automatically by `defineDurableState`. [2, 3]
6. **Persist first, notify second.** Store authoritative run transitions, publish small authorized live notifications, then let clients refetch/reconcile after reconnect. Event IDs/replay cursors are application-owned. A failed publish must not erase a completed run or masquerade as failed business work. For a standalone CLI/TUI, do not assume the documented browser helper is a ready-made authenticated Node transport; design an explicit transport adapter. [3, 4]

### P2 — make operations deploy-aware

7. **Preflight inference and version boundaries.** Verify bindings in the actual consuming app with `void info`/generated artifacts; explicitly scan nonstandard helper directories while preserving required defaults. Avoid scanner dependence on executing job modules or private hashed SDK bundles; use those bundles only as version-pinned research evidence. Validate native/framework queue delivery separately. [2, 3, 6, S2, S3]
8. **Correlate rather than replace platform logs.** Emit structured `runId`/job/expression/attempt/deployment metadata and link activity to project logs. Keep paged administrator deployment logs an optional privileged adapter, with cursor deduplication and bounded queries. Surface data-schema compatibility before rollback and rehydrate UI state after deploy. [3, 4, 7–9]

## Sources

Official pages fetched over HTTPS on 2026-10-22 (not inferred from search snippets):

1. [Cron Jobs](https://void.cloud/guide/jobs)
2. [Queues](https://void.cloud/guide/queues)
3. [Durable State](https://void.cloud/guide/durable-state)
4. [Live Event Streams](https://void.cloud/guide/live)
5. [Environment Variables](https://void.cloud/guide/env-vars)
6. [Resource Inference](https://void.cloud/reference/resource-inference)
7. [Deployment](https://void.cloud/guide/deployment)
8. [Project commands — logs](https://void.cloud/reference/cli/project#void-project-logs) (also checked installed `docs/reference/cli/project.md`)
9. [Platform Operations](https://void.cloud/reference/cli/platform-operations)

Installed primary-source evidence, all relative to `apps/coffee-api/node_modules/void/` (`package.json`: version 1.1.11; hashed filenames are version-specific):

- **S1:** `dist/handler-_PqY82xe.d.mts:185,269`; `dist/handler-BZ1t7-Rv.mjs:126` — scheduled type and identity wrapper.
- **S2:** `dist/wrapper-BOigE1xJ.mjs:526–599` — framework production auth, expression fanout, aggregate failure.
- **S3:** `dist/index.mjs:715–735,1705–1755,2299–2344,2742–2745` — token file convention, framework development dispatch, native internal route/auth, runtime-env scope.
- **S4:** `dist/queues-BWKt1Xo4.d.mts`; `dist/runtime/queues.d.mts` — generated `QueueMap` producer surface.
- **S5:** `dist/live-DJONVlQK.d.mts:96–100`; `dist/runtime/live.d.mts` — live connect/control/publish/explicit-env contracts.
- **R1:** repository `packages/crons/src/trigger.ts` — read-only integration context; working-tree content, not independently audited here.

**Unverified:** deployed project reachability/auth, actual remote scheduler delivery/retry behavior, platform installation version, effective quotas/permissions, end-to-end queue/live behavior, and crash-safe application coordination. Source inspection confirms contracts, not successful operation of this workspace's deployment.
