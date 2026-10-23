# void-crons: implementation assessment and roadmap

Assessed 2026-10-22 against the current working tree, including existing user changes, the installed `void@1.1.11` in `apps/coffee-api`, and current official Void documentation. No production calls or deployments were made. This is an assessment, not an implementation change. See [platform research](./2026-10-22-void-crons-platform-research.md) for detailed SDK contracts and primary sources.

## Recommendation

Keep `void-crons` as the development and operations companion to Void's scheduler, not a replacement production scheduler. Its useful differentiator is one coherent view of definitions, expression dispatches, actual handler runs, downstream queue work, and deployment identity. Correct the existing semantic gaps before adding more UI or scheduling features.

The current package already provides substantial value: safe source discovery without executing jobs, cron validation and preview, a local scheduler, retries, activity stores, a React panel, and a TUI. The gap is integration correctness, not a lack of dashboard features.

## Verified findings

### P0: disable is not an execution or deployment guarantee

- `packages/crons/src/cli.ts:265` scans with disabled state, but the named-job branch at line 267 calls `triggerExpression` directly at line 276, bypassing `triggerJob`'s disabled guard (`src/trigger.ts:145`). A temporary fixture with a disabled job dispatched one mocked HTTP request and returned exit code 0.
- `src/schedule.ts:79` collapses jobs into expression targets. Void dispatches every matching handler for that expression, including a locally disabled job if an enabled sibling exports the same expression. Skipping one row cannot prevent this fanout.
- `src/manifest.ts:48` omits disabled jobs from this package's manifest. The inspected SDK scans `crons/` and constructs its own deployment schedules; no evidence was found that it consumes `void.crons.json`. This artifact does not by itself disable a deployed job or alter the SDK build.

**Change:** enforce the named-trigger guard immediately; call local disable a local preference. For actual runtime pause, add an explicit handler-side policy checked before business work. Until then, block or clearly disclose mixed enabled/disabled expression groups. Call emitted output an inspection artifact unless an explicit build integration is implemented and tested. An application pause guard suppresses work; it does not remove the platform schedule.

### P0: expression dispatch is presented as a single-job run

`src/trigger.ts:83` sends only `{ cron, scheduledTime }`; `jobName` is local metadata. `src/schedule.ts:84` stores only one job name per expression. Void waits for all matching handlers and aggregates failures. A successful response cannot supply individual durations/items, and a failed response does not mean every matching job failed. Retrying a shared expression can repeat siblings that already succeeded.

**Change:** model expression dispatch separately from handler execution. Expose affected job names before Run; group activity by dispatch; add an optional handler instrumentation wrapper preserving the real `(controller, env, ctx)` signature. Use correlation IDs and application idempotency keys. A proposed per-job endpoint must be a separately authenticated application API, not an invented option to `/__void/scheduled`.

### P0: target and credential classification is too weak

`src/trigger.ts:11` identifies local targets through string containment. A mocked request to `https://localhost.attacker.example` is classified local, while `http://[::1]:5173` is classified remote and receives a test internal secret. Line 78 sends a provided development token to any origin, regardless of classification. No real credentials or network were used in these probes.

The installed native and framework production trigger paths have different authorization. Framework generation uses proxy-token precedence over `CRON_SECRET`; native generation does not use that same fallback. Merely having a secret is not proof that a production endpoint is usable.

**Change:** parse with `URL`, validate protocol/origin, compare exact loopback hosts, and explicitly select dev/framework/custom transports. Attach only the credential for that transport; prohibit accidental cross-origin redirects and redact diagnostics. Do not label a target's effects safe because its HTTP address is local: Void remote mode can make local code write deployed resources. Add separate execution-location and binding-environment metadata, an unknown state, and an explicit remote-write opt-in. Do not claim local config proves the state of an independently started server.

### P1: scanner and compatibility checks lag the real SDK

- `src/scan.ts:113` uses regex extraction. The fixture `export const cron = ["0 * * * *", runtimeExpression]` is accepted as one active expression; the SDK's AST-based scanner rejects the dynamic array member. String contents can also look like source exports to regex matching.
- A fixture with a cron export and no default handler is reported active. This package promises handler validation but does not establish it; the inspected native dispatcher skips non-function defaults.
- `src/cli.ts:35` and `resolveApps` discover only `void.json`. The current coffee apps use `void.config.ts` and are excluded from `--all`.
- `src/void.d.ts:1` and the README still say the real npm SDK is unavailable. The repo now installs `void@1.1.11`; the ambient shim omits the real environment/context arguments and supplies a simplified HTTP handler signature. Legacy apps still declare `void@^0.1.0`, so the repo spans incompatible generations.
- `src/manifest.ts:34` applies managed-platform limits as constants without target context. Official docs explicitly distinguish direct Cloudflare limits.

**Change:** use static AST inspection, not module evaluation, and reject an entire invalid export rather than extracting the valid substring. Add structural handler checks with documented limitations. Discover current config conventions, report resolved SDK version/framework/target, remove misleading ambient SDK declarations, and use real SDK types for integration fixtures. Keep source-vs-manifest drift separate from source-vs-build or build-vs-deployed drift. Do not import SDK-private hashed bundles in production code.

### P1: root imports are not Worker-safe persistence

`src/index.ts:2` re-exports filesystem scanning; line 5 re-exports a store that statically imports `node:sqlite` (`src/store.ts:3`). `CronStore` is synchronous and in-memory while the disk history APIs are separate. These APIs do not form a usable async production persistence boundary. Type-only imports are erased and are not themselves the problem.

**Change:** keep Node discovery/SQLite/TUI behind Node-specific exports; add a dependency-light runtime/types entry and an async persistence interface. Preserve SQLite/JSONL for offline/local operation. Offer an opt-in D1/Drizzle adapter rather than introducing another database layer. `apps/coffee-api/src/jobs/index.ts:30` already executes jobs and records D1 history with retention; generalize that pattern rather than running two competing histories. Separate scheduled time from actual start time, and do not let a notification/telemetry failure become a retry of already-completed business work.

### P2: scheduler policy needs explicit bounds

`src/schedule.ts:135` repeats a trailing-24h catch-up on every invocation; it is not a persisted recovery checkpoint. `tickSchedule` marks minutes before dispatch, and live state is in memory. `computeDue` silently truncates after 2,000 occurrences per expression (`src/schedule.ts:19`), so long gaps can lose executions when the checkpoint advances. The initial live-loop “next” message uses `latestDue` across eight days, not the nearest occurrence. These are local-tool semantics, not production delivery guarantees.

**Change:** define skip/latest/bounded-backfill policies, report truncation, persist dispatch checkpoints if restart recovery is promised, and require idempotency before replay. Use nearest occurrence for the next-fire display. Distinguish wall-clock preview timezone from the UTC platform schedule. Do not advertise exactly-once execution.

## How the rest of Void changes the design

These are proposed integrations, not existing `void-crons` APIs:

1. **Queues:** use cron to identify due work and publish typed messages with `void/queues`; consumers own expensive batches and per-message retries. Track enqueued versus completed separately, with run/message correlation. Queue acknowledgment does not make external effects exactly-once. Void-managed queues have no automatic DLQ, so durable failure/exhaustion handling must be designed explicitly. Native and meta-framework local delivery differ. [Queues](https://void.cloud/guide/queues)
2. **Durable state:** optionally use native Void `defineDurableState` for per-job claims, leases, pause state, and overlap policy. Serialize short state transitions, not an entire expensive job. Lease acquisition, queue publishing, and external side effects are not one atomic transaction; include reconciliation/idempotency. Durable helpers are native-app features, not a universal framework adapter. [Durable State](https://void.cloud/guide/durable-state)
3. **D1/KV/R2:** use D1 for queryable run history and audit records, KV only for eventual/derived views rather than authoritative coordination, and R2 for large logs or exported results. Avoid introducing all three by default. Keep payloads and secrets out of the activity feed. [Inference](https://void.cloud/reference/resource-inference), [KV](https://void.cloud/guide/kv), [Storage](https://void.cloud/guide/storage)
4. **Live/SSE:** persist authoritative run transitions first, publish small authorized notifications through `void/live`, and refetch after reconnect. Raw SSE fits a single streaming request; durable multi-topic live notifications fit shared monitoring. Do not assume the browser subscription helper automatically provides an authenticated CLI/TUI client. [Live](https://void.cloud/guide/live), [SSE](https://void.cloud/guide/sse)
5. **Auth/typed routes:** make pause, manual run, replay, history, and live subscription server-authorized operations using the consuming app's auth. Native managed auth has target restrictions; do not bake it into every adapter. Existing coffee admin-to-API separation is a better starting point than exposing internal trigger credentials in React props. Audit who initiated manual work. [Auth](https://void.cloud/guide/auth), [Typed Fetch](https://void.cloud/guide/typed-fetch)
6. **Environment, inference, deployment, logs:** preserve app SDK execution so bindings and typed env work normally. Verify inferred resources in the consuming application with `void info` and generated artifacts, especially for helpers placed outside scanned directories. Record project/environment/deployment identity, correlate structured run IDs with platform logs, and leave provisioning/secrets/deployment to Void. Do not imply a local artifact reflects deployed state. [Environment](https://void.cloud/guide/env-vars), [Deployment](https://void.cloud/guide/deployment), [Project commands](https://void.cloud/reference/cli/project)
7. **Remote development:** surface remote D1/KV/R2 and always-proxied AI risk before replay or catch-up. Repeated cron runs can mutate real data, send real emails, invoke paid AI, or launch sandbox work; these features are workloads to observe and protect, not reasons to build separate schedulers. [Remote Development](https://void.cloud/guide/remote-dev), [AI](https://void.cloud/guide/ai), [Email](https://void.cloud/guide/email), [Sandboxes](https://void.cloud/guide/sandboxes)
8. **Existing Flow package:** the repo's workflow wakeups in `apps/api/crons/cleanup.ts` are application-level orchestration. Correlate wakeup runs and workflow IDs if retained; do not describe `packages/flow` as a verified built-in Void Cloud Workflows service or replace it without a separate architecture decision.

## Delivery order and acceptance criteria

### Phase 1: truthful, safe local operations

Fix named disabled dispatch, shared-expression disclosure/attribution, URL/token handling, modern app discovery, AST validation, and outdated SDK statements. Add a capability report showing SDK version, native/framework runtime, deployment target, trigger transport, and known/unknown binding mode.

Acceptance: the disabled fixture dispatches zero requests; all shared handlers are disclosed; malformed arrays fail; config-only apps appear under `--all`; non-loopback hosts never qualify through substrings; IPv6 is recognized; no dev token is forwarded to a remote transport. Cross-check generated schedules and endpoint behavior against real version-pinned SDK fixtures, not only mocked fetches.

### Phase 2: real handler telemetry

Add runtime-safe instrumentation and async stores; adapt the coffee API's D1 history; preserve `(controller, env, ctx)` and exceptions; use run/dispatch/attempt identifiers, project identity, retention, and redaction. Keep transport timeouts distinct from observed handler failures: the server may complete after the client stops waiting.

Acceptance: sibling success plus sibling failure are represented separately; a dropped response is not recorded as proven business failure; metrics come from actual handlers; a telemetry failure does not duplicate business work; published runtime entry builds for a Worker without filesystem/Node SQLite dependencies.

### Phase 3: SDK-native orchestration and monitoring

Add optional queue correlation, native durable coordination, authorized live notifications, deployment/log links, and bounded replay policies. Preserve existing UI/TUI as projections over authoritative events rather than adding another scheduling service.

Acceptance: persisted history survives reconnect; forbidden clients cannot subscribe/control; queue retry does not masquerade as cron retry; duplicate delivery is safe for a representative workload; native/framework/staging cases are independently exercised. Run a packed-package CLI smoke test in addition to workspace tests.

## Verification performed

- `pnpm --filter void-crons test`: **100 passed, 0 failed**.
- `pnpm typecheck` from `packages/crons`: **passed**.
- Temporary scanner fixtures: mixed static/dynamic array and missing-handler job both reported active.
- Mocked CLI fixture: disabled named job dispatched once and exited successfully.
- Mocked URL/header probes: substring hostname classified local; IPv6 loopback received an internal test secret; supplied dev token forwarded in both cases.
- Source inspection: SDK independently scans jobs/builds schedules; native/framework auth differs; handler dispatch fans out by expression.

These checks do not verify deployed permissions, quotas, runtime logs, or a production remote trigger. No implementation files were modified for this assessment.
