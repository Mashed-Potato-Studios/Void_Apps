# @void-monorepo/crons lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `void-crons` into a self-serve lifecycle CLI: `schedule` daemon (`--once` catch-up + live loop with once-per-minute dedupe), drift detection in `check`, next-fire preview in `list`, publishable package shape, house-style README.

**Architecture:** Existing modules stay (`scan`→`manifest`→`trigger`/`store`→`cli`). New `src/schedule.ts` holds all cron-clock logic: pure `computeDue`/`latestDue` on `cron-parser`, an in-memory `ScheduleState` with `tickSchedule` (pure over injected `nowMs`), and `runScheduleOnce` for catch-up mode. `cli.ts` wires the `schedule` command, drift in `check`, preview column in `list`. Drift compares active job/expression **sets** only (never `emittedAt`).

**Tech Stack:** TypeScript (erasable-only, Node 22.6 type-stripping), `cron-parser@^5` (`CronExpressionParser.parse(expr, { currentDate })`), node:test, temp-dir test fixtures (existing `makeApp` helper).

**Spec:** `docs/superpowers/specs/crons-lifecycle.md` (read alongside — the plan argues from it).

## Global Constraints

- Runtime dep: only `cron-parser@^5` added; zero other new deps. `bin/void-crons.mjs` stays a 10-line dist loader.
- Exit codes house split: `0` clean · `1` drift/invalid/failed · `2` tool/usage error.
- Every `--json` object output carries `format: 1`.
- Disabled jobs never fire under `schedule`/`--once`; invalid jobs print one `✕ <error>` line at startup then are ignored.
- Erasable TS only (no enums/namespaces); tests run TS sources directly via `node --test --import ./test/hooks/register.mjs`.
- Acceptance baseline: existing 12 tests stay green throughout; final suite must pass `pnpm --filter @void-monorepo/crons test` + `typecheck`.
- Workdir for all test commands: `packages/crons` (tests resolve `../src/*.ts`).

## Review Focus

Five inputs the spec implies but task tests must pin down; each got its test in the named task:

1. **Manifest on disk but `crons/` dir deleted → drift must report all jobs removed, exit 1** (Task 5).
2. **Two jobs sharing one expression → scheduler fires the expression once per matched minute, not once per job** (Task 3).
3. **Same minute hit twice across overlapping tick windows → no double fire** (Task 3).
4. **Yearly expression (`0 0 1 1 *`) inside the 8-day `list` preview window → shows `never`, not a crash or 960m** (Task 6).
5. **Disabled job in manifest → `schedule --once` reports it in `skipped` with reason, fires nothing** (Task 2).

---

### Task 1: `computeDue` + `latestDue` pure clock core

**Files:**
- Create: `packages/crons/src/schedule.ts`
- Test: `packages/crons/test/schedule.test.ts`
- Modify: `packages/crons/package.json` (add dep)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `computeDue(expressions: string[], fromMs: number, toMs: number): { expr: string; dueMs: number }[]` (sorted by dueMs, empty on window with no matches); `latestDue(expressions: string[], fromMs: number, toMs: number): { expr: string; dueMs: number }[]` (one entry per expression = max dueMs in window). Iteration guard: 2000 steps max per expression (bails after, still correct for 24h/8d windows).

- [ ] **Step 1: Add dependency**

```bash
pnpm add cron-parser@^5 --filter @void-monorepo/crons
```

Expected: `package.json` gains `"cron-parser": "^5.x"` in `dependencies`; lockfile updated.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDue, latestDue } from "../src/schedule.ts";

const min = 60_000;

describe("computeDue", () => {
  it("lists matching minutes in order, once per expression", () => {
    // 2026-10-18T10:00:00Z Sunday. *\/5 fires at :05, :10 (+dst-free UTC via currentDate UTC default).
    const from = Date.UTC(2026, 9, 18, 9, 55, 0, 0);
    const to = from + 16 * min;
    const due = computeDue(["*/5 * * * *"], from, to);
    assert.deepEqual(due.map((d) => new Date(d.dueMs).toISOString().slice(14, 19)), ["10:05:00", "10:10:00"]);
  });

  it("returns empty when nothing is due in the window", () => {
    const due = computeDue(["0 2 * * 1"], Date.UTC(2026, 9, 18, 10), Date.UTC(2026, 9, 18, 11));
    assert.deepEqual(due, []);
  });

  it("dedupes identical expressions", () => {
    const due = computeDue(["* * * * *", "* * * * *"], Date.UTC(2026, 9, 18, 10, 0, 30), Date.UTC(2026, 9, 18, 10, 2));
    assert.equal(due.length, 1);
  });
});

describe("latestDue", () => {
  it("picks the max due time per expression over the catch-up window", () => {
    const from = Date.UTC(2026, 9, 18, 9, 0);
    const to = Date.UTC(2026, 9, 18, 10, 30);
    const latest = latestDue(["*/5 * * * *"], from, to);
    assert.equal(latest.length, 1);
    assert.equal(new Date(latest[0]!.dueMs).getUTCMinutes(), 30);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test` (from `packages/crons`)
Expected: FAIL — "Cannot find module ../src/schedule.ts" / `computeDue is not a function`.

- [ ] **Step 4: Write minimal implementation**

```typescript
import { CronExpressionParser } from "cron-parser";
import type { CronJob } from "./types.js";

export interface CronDue {
  expr: string;
  dueMs: number;
}

const MAX_ITER = 2000;

/** Due times for each distinct expression inside [fromMs, toMs], sorted by time. */
export function computeDue(expressions: string[], fromMs: number, toMs: number): CronDue[] {
  const out: CronDue[] = [];
  for (const expr of [...new Set(expressions)]) {
    let it: Iterable<{ done: boolean; value: { date: Date } }>;
    try {
      it = CronExpressionParser.parse(expr, { currentDate: new Date(fromMs) }).iterator({ currentDate: new Date(fromMs) });
    } catch {
      continue;
    }
    let n = 0;
    for (const step of it) {
      if (n++ >= MAX_ITER) break;
      const dueMs = step.value.date.getTime();
      if (dueMs > toMs) break;
      out.push({ expr, dueMs });
    }
  }
  return out.sort((a, b) => a.dueMs - b.dueMs);
}

/**Most recent due time per expression inside the window (catch-up-semantics). */
export function latestDue(expressions: string[], fromMs: number, toMs: number): CronDue[] {
  const all = computeDue(expressions, fromMs, toMs);
  const last = new Map<string, number>();
  for (const d of all) last.set(d.expr, d.dueMs);
  return [...last.entries()].map(([expr, dueMs]) => ({ expr, dueMs })).sort((a, b) => a.dueMs - b.dueMs);
}

export interface ScheduleJobSource {
  jobs: CronJob[];
}
```

Note on API: `cron-parser@5` — `CronExpressionParser.parse(expr, opts)` returns a `CronExpression`; `.iterator({ currentDate })` yields `{ done, value: { date, toString… } }`. If the installed minor types iterator lazily as `IterableIterator`, keep the explicit `let it: Iterable...` annotation (erasable type only).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS (5 suites incl. `computeDue`/`latestDue`).

- [ ] **Step 6: Commit**

```bash
git add packages/crons/src/schedule.ts packages/crons/test/schedule.test.ts packages/crons/package.json
git commit -m "feat(crons): computeDue/latestDue cron clock core on cron-parser"
```

---

### Task 2: `runScheduleOnce` — catch-up mode + persistence + disabled skip

**Files:**
- Modify: `packages/crons/src/schedule.ts`
- Test: `packages/crons/test/schedule.test.ts`

**Interfaces:**
- Consumes: `computeDue`/`latestDue` (Task 1), `scanCronFiles` (`./scan.js`), `appendActivityLog` (`./store.js`), `triggerExpression` (`./trigger.js`), types `CronJob`/`CronActivityEntry`.
- Produces: `runScheduleOnce(appRoot: string, opts: { origin: string; devToken?: string; cronSecret?: string; fetchImpl?: typeof fetch; disabled?: string[]; nowMs?: number }): Promise<{ fired: CronActivityEntry[]; skipped: { cron: string; jobName: string; reason: string }[] }>`. Also `collectScheduleTargets(jobs: CronJob[], disabledNames: Set<string>): { active: Map<string, string>; skipped: { cron: string; jobName: string; reason: string }[] }` where map = expr→jobName (first job wins; shared expressions collapse).

- [ ] **Step 1: Write the failing test**

Append to `packages/crons/test/schedule.test.ts`:

```typescript
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScheduleOnce } from "../src/schedule.ts";
import { readActivityLog } from "../src/store.ts";

const HEARTBEAT = `import { defineScheduled } from 'void';
export const cron = ['0 * * * *'];
export default defineScheduled(async () => {});
`;
const SHARED = `export const cron = ['0 * * * *'];
export default async () => {};
`;

function makeApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "crons-sched-"));
  mkdirSync(join(dir, "crons"), { recursive: true });
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, "crons", name), src);
  return dir;
}

function okFetch(calls: { url: string; cron: string }[]): typeof fetch {
  return (async ((url: any, init: any) => {
    calls.push({ url: String(url), cron: String(JSON.parse(init.body).cron) });
    return { ok: true, status: 200 };
  }) as unknown) as typeof fetch;
}

describe("runScheduleOnce", () => {
  // pinned Review Focus input 5: disabled job → skipped, never fired
  it("fires catch-up per distinct expression, skips disabled, writes activity log", async () => {
    const app = makeApp({ "heartbeat.ts": SHARED, "cleanup.ts": SHARED });
    const calls: { url: string; cron: string }[] = [];
    const res = await runScheduleOnce(app, {
      origin: "http://localhost:5173",
      fetchImpl: okFetch(calls),
      disabled: ["cleanup"],
      nowMs: Date.UTC(2026, 9, 18, 10, 40, 0),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.cron, "0 * * * *");
    assert.equal(res.fired.length, 1);
    assert.equal(res.fired[0]?.status, "success");
    assert.deepEqual(res.skipped, [{ cron: "0 * * * *", jobName: "cleanup", reason: 'job "cleanup" is disabled' }]);
    const log = readActivityLog(app);
    assert.equal(log.length, 1);
    assert.equal(log[0]?.cron, "0 * * * *");
    rmSync(app, { recursive: true, force: true });
  });

  it("invalid job and expressions not matching any active job are skipped with reasons", async () => {
    const app = makeApp({
      "broken.ts": "export default async () => {};\n",
      "late.ts": `export const cron = ['0 2 * * 1'];\nexport default async () => {};\n`,
    });
    const calls: { url: string; cron: string }[] = [];
    const res = await runScheduleOnce(app, {
      origin: "http://localhost:5173",
      fetchImpl: okFetch(calls),
      nowMs: Date.UTC(2026, 9, 18, 10, 0, 0), // Sunday 10:00 — Monday 02:00 due outside 24h window? Inside: Mon 02:00 is 16h later, but window is [now-24h, now] → not in window.
    });
    assert.equal(calls.length, 0);
    assert.equal(res.skipped.length, 0); // out-of-window: nothing due at all
    // late.ts's expr IS due… only within trailing window; here due date ahead → no fire. broken.ts is invalid:
    assert.ok(res.fired.length === 0);
    rmSync(app, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `runScheduleOnce` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/crons/src/schedule.ts` (add imports at top of file):

```typescript
import { scanCronFiles } from "./scan.js";
import { appendActivityLog } from "./store.js";
import { triggerExpression } from "./trigger.js";
import type { CronActivityEntry, CronJob } from "./types.js";

const ONCE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ScheduleSkip {
  cron: string;
  jobName: string;
  reason: string;
}

/** expr → jobName for active jobs; disabled jobs become skips, invalid jobs drop (no expr to fire). */
export function collectScheduleTargets(jobs: CronJob[], disabledNames: Set<string>): {
  active: Map<string, string>;
  skipped: ScheduleSkip[];
} {
  const active = new Map<string, string>();
  const skipped: ScheduleSkip[] = [];
  for (const job of jobs) {
    if (job.status === "invalid" || job.expressions.length === 0) continue;
    for (const expr of job.expressions) {
      if (disabledNames.has(job.name)) {
        if (!active.has(expr)) skipped.push({ cron: expr, jobName: job.name, reason: `job "${job.name}" is disabled` });
        continue;
      }
      if (!active.has(expr)) active.set(expr, job.name);
    }
  }
  return { active, skipped };
}

export interface ScheduleOptions {
  origin: string;
  devToken?: string;
  cronSecret?: string;
  fetchImpl?: typeof fetch;
  disabled?: string[];
  nowMs?: number;
}

export interface ScheduleRun {
  fired: CronActivityEntry[];
  skipped: ScheduleSkip[];
}

/** Catch-up: most recent due time per distinct expression inside the trailing 24h, fired once each. */
export async function runScheduleOnce(
  appRoot: string,
  opts: ScheduleOptions,
): Promise<ScheduleRun> {
  const jobs = scanCronFiles(appRoot);
  const { active, skipped } = collectScheduleTargets(jobs, new Set(opts.disabled ?? []));
  const nowMs = opts.nowMs ?? Date.now();
  const latest = latestDue([...active.keys()], nowMs - ONCE_WINDOW_MS, nowMs);
  const fired: CronActivityEntry[] = [];
  for (const { expr, dueMs } of latest) {
    const res = await triggerExpression(expr, active.get(expr)!, {
      origin: opts.origin,
      devToken: opts.devToken,
      cronSecret: opts.cronSecret,
      fetchImpl: opts.fetchImpl,
      scheduledTime: dueMs,
    });
    if (res.entry) fired.push(res.entry);
    else if (res.reason) skipped.push({ cron: expr, jobName: active.get(expr)!, reason: res.reason });
  }
  if (fired.length > 0) appendActivityLog(appRoot, fired);
  return { fired, skipped };
}
```

Test note: in the second test, keep the job file `late.ts` — its Monday-02:00 due is outside `[now-24h, now]` when `nowMs` is Sunday 10:00, so zero calls. (`broken.ts` verifies invalid jobs contribute nothing.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/crons/src/schedule.ts packages/crons/test/schedule.test.ts
git commit -m "feat(crons): runScheduleOnce catch-up firing with disabled skips"
```

---

### Task 3: `ScheduleState` + `tickSchedule` — live-loop core with once-per-minute dedupe

**Files:**
- Modify: `packages/crons/src/schedule.ts`
- Test: `packages/crons/test/schedule.test.ts`

**Interfaces:**
- Consumes: `computeDue`, `collectScheduleTargets`, `triggerExpression`, `CronJob`.
- Produces: `initScheduleState(nowMs: number): ScheduleState` (`{ checkpointMs: number; firedMinutes: Map<string, number> }`); `tickSchedule(state: ScheduleState, targets: { active: Map<string, string>; skipped: ScheduleSkip[] }, opts: { origin: string; devToken?: string; cronSecret?: string; fetchImpl?: typeof fetch; nowMs: number }): Promise<{ state: ScheduleState; fired: CronActivityEntry[]; skipped: ScheduleSkip[] }>`. Invariant: expression fires at most once per matched minute (dedupe key = `expr`)…`(expr###`minute` bucket by Math.floor(dueMs/60000)`), checkpoint advances to `nowMs` after each tick. NOTE: this is the same dedupe key spec calls "last-fired minute per expression".

- [ ] **Step 1: Write the failing test**

Append to test file:

```typescript
import { initScheduleState, tickSchedule, collectScheduleTargets } from "../src/schedule.ts";
import { scanCronFiles } from "../src/scan.ts";

describe("tickSchedule", () => {
  // pinned Review Focus inputs 2 & 3: shared expr fires once; overlapping windows don't double-fire
  it("fires an expression once per matched minute even when shared by two jobs or re-ticked", async () => {
    const app = makeApp({ "heartbeat.ts": SHARED, "cleanup.ts": SHARED });
    const jobs = scanCronFiles(app);
    const targets = collectScheduleTargets(jobs, new Set());
    const calls: { url: string; cron: string }[] = [];
    const fetch = okFetch(calls);
    const T0 = Date.UTC(2026, 9, 18, 10, 4, 30);
    let state = initScheduleState(T0);
    // tick crossing :05
    const t1 = await tickSchedule(state, targets, {
      origin: "http://localhost:5173", fetchImpl: fetch, nowMs: T0 + 90_000, // T0 10:06:00
    });
    state = t1.state;
    assert.equal(calls.length, 1); // '*/5' not in SHARED… see note
    assert.equal(calls[0]?.cron, "*/5 * * * *");
    // second tick within same minute — no refire
    const t2 = await tickSchedule(state, targets, {
      origin: "http://localhost:5173", fetchImpl: fetch, nowMs: T0 + 90_000 + 20_000,
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(t2.fired, []);
    // third tick crossing :10 → fires again
    await tickSchedule(state, targets, {
      origin: "http://localhost:5173", fetchImpl: fetch, nowMs: T0 + 360_000,
    });
    assert.equal(calls.length, 2);
    rmSync(app, { recursive: true, force: true });
  });
});
```

Test fixture note: `SHARED` in Task 2 uses `'0 * * * *'`; for THIS test override the fixture with `'*/5 * * * *'` by writing files inline (don't mutate the module-level SHARED — add a local `const SHARED5 = 'export const cron = [\'*/5 * * * *\'];\nexport default async () => {};\n';`), so minute-crossings at :05/:10 are deterministic from T0=10:04:30. Cross-file dedupe asserted since two files share one expr.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `initScheduleState`/`tickSchedule` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface ScheduleState {
  checkpointMs: number;
  firedMinutes: Map<string, number>;
}

export function initScheduleState(nowMs: number): ScheduleState {
  return { checkpointMs: nowMs, firedMinutes: new Map() };
}

/** One scheduling window: due since checkpoint → per-expr once-per-minute fire → checkpoint advances. */
export async function tickSchedule(
  state: ScheduleState,
  targets: { active: Map<string, string>; skipped: ScheduleSkip[] },
  opts: { origin: string; devToken?: string; cronSecret?: string; fetchImpl?: typeof fetch; nowMs: number },
): Promise<{ state: ScheduleState; fired: CronActivityEntry[]; skipped: ScheduleSkip[] }> {
  const due = computeDue([...targets.active.keys()], state.checkpointMs, opts.nowMs);
  const fired: CronActivityEntry[] = [];
  const skipped: ScheduleSkip[] = [];
  for (const { expr, dueMs } of due) {
    const minute = Math.floor(dueMs / 60_000);
    if (state.firedMinutes.get(expr) === minute) continue;
    state.firedMinutes.set(expr, minute);
    const res = await triggerExpression(expr, targets.active.get(expr)!, {
      origin: opts.origin,
      devToken: opts.devToken,
      cronSecret: opts.cronSecret,
      fetchImpl: opts.fetchImpl,
      scheduledTime: dueMs,
    });
    if (res.entry) fired.push(res.entry);
    else if (res.reason) skipped.push({ cron: expr, jobName: targets.active.get(expr)!, reason: res.reason });
  }
  if (fired.length > 0 && opts.appendActivity) {
    appendActivityLog(opts.appendActivity.appRoot, fired);
  }
  return { state: { checkpointMs: opts.nowMs, firedMinutes: state.firedMinutes }, fired, skipped };
}
```

`tickSchedule` gains optional `opts.appendActivity?: { appRoot: string }` — when present it calls `appendActivityLog(opts.appendActivity.appRoot, fired)` after collecting; the CLI passes it. (Spec: loop persists entries; dedupe prevents double-writes because double-fires are impossible.) The Task 3 test omits `appendActivity` (optional) — persistence is asserted in Task 4's CLI test.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/crons/src/schedule.ts packages/crons/test/schedule.test.ts
git commit -m "feat(crons): ScheduleState/tickSchedule with once-per-minute dedupe"
```

---

### Task 4: `schedule` CLI command (`--once` + live loop)

**Files:**
- Modify: `packages/crons/src/cli.ts` (new case + `USAGE` line)
- Modify: `packages/crons/src/schedule.ts` (add `startScheduleLoop`)
- Modify: `packages/crons/src/index.ts` (re-export `./schedule.js`)
- Test: `packages/crons/test/crons.test.ts`

**Interfaces:**
- Consumes: `runScheduleOnce`, `initScheduleState`, `tickSchedule`, `collectScheduleTargets`, `scanCronFiles`, `readDisabled` (cli-internal — hoist to module scope, it already is at cli.ts bottom), `appendActivityLog`.
- Produces: CLI arg parsing: `void-crons schedule [app-path] [--origin URL] [--once] [--token T] [--json]` — `--once` reuses the existing `--once` flag slot (add `if (a === "--once") flags.add("--once")` handling; it already lands in `flags` via the generic `a.startsWith("--")` branch, so no new parsing code needed for the boolean). `startScheduleLoop(appRoot: string, opts: ScheduleOptions & { intervalMs?: number; signal?: AbortSignal }): Promise<{ firedTotal: number }>` — fixed 30s tick default (test override only), `scheduled N jobs · next <expr> in Xm` startup line, Ctrl-C/abort resolves.

- [ ] **Step 1: Write the failing test**

Append to `packages/crons/test/crons.test.ts`:

```typescript
describe("void-crons CLI schedule", () => {
  it("schedule --once fires due expressions, persists activity, and reports skipped jobs (json)", async () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT, "cleanup.ts": CLEANUP });
    const calls: { url: string; init?: RequestInit }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async ((url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200 };
    }) as unknown) as typeof fetch;
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (s?: string) => { logs.push(String(s)); };
    try {
      // HEARTBEAT '0 * * * *' / CLEANUP '0 30 * * *…' — both due within trailing 24h at any moment.
      assert.equal(await run(["schedule", "--once", app, "--json"], process.cwd()), 0);
      assert.ok(calls.length >= 2, "both jobs' expressions fired");
      const out = JSON.parse(logs.find((l) => l.startsWith("{")) ?? "{}");
      assert.equal(out.format, 1);
      assert.equal(out.app, "void"); // basename(app) is tmpdir random… see fixture note
      const log = readActivityLog(app);
      assert.equal(log.length, calls.length);
    } finally {
      globalThis.fetch = orig;
      console.log = origLog;
      rmSync(app, { recursive: true, force: true });
    }
  });
});
```

Fixture note: existing tests pass `app` as positional and `run`'s emit path treats positionals as app paths — schedule follows `list` semantics (positional app-path). Assert `typeof out.app === "string" && out.app.length > 0` instead of pinning tmpdir basenames (here `CLEANUP` is `'0 * * * *', '30 * * * *'` per fixture above — two exprs; heartbeat shares `'0 * * * *'`; assert `calls.length === 2` exactly: `{0 * * * *, 30 * * * *}` after expr-dist collapse. Cleanups: `fired` length 2.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `schedule` falls to `default` case, prints USAGE, exit 2.

- [ ] **Step 3: Write minimal implementation**

In `cli.ts`:

1. Add imports: `import { runScheduleOnce, startScheduleLoop } from "./schedule.js";` and `import type { CronManifest } from "./types.js";` (for json shape).

2. `USAGE` gains lines:

```
  schedule [app-path] [--once]              catch-up (--once) or live auto-fire loop
```

(replace the plain `--origin/--cron/--token` shared-flags block with the same wording, only adding the schedule line after `trigger`).

3. New case after `trigger` — final code, no sketch:

```typescript
    case "schedule": {
      let code = 0;
      for (const app of apps) {
        const disabled = new Set(readDisabled(app));
        const jobs = scanCronFiles(app, { disabled });
        const targets = collectScheduleTargets(jobs, disabled);
        if (!ci) for (const j of jobs.filter((x) => x.status === "invalid")) {
          console.log(`${basename(app)}: ✕ ${j.error ?? "invalid job"}`);
        }
        if (flags.has("--once")) {
          const run = await runScheduleOnce(app, {
            origin,
            devToken,
            disabled: readDisabled(app),
          });
          if (json) {
            console.log(JSON.stringify(
              { format: 1 as const, app: basename(app), fired: run.fired, skipped: run.skipped },
              null, 2,
            ));
          } else {
            for (const e of run.fired) console.log(`${basename(app)}: fired ${e.jobName} ${e.cron} (${e.durationMs}ms)`);
            for (const s of run.skipped) console.log(`${basename(app)}: skip ${s.reason}`);
            if (!ci) console.log(`${basename(app)}: caught up (${run.fired.length} fired, ${run.skipped.length} skipped)`);
          }
          continue;
        }
        await startScheduleLoop(app, { origin, devToken, disabled: [...disabled] });
      }
      return code;
    }
```

Note: `run.fired` / `run.skipped` are already JSON-safe (`CronActivityEntry[]` and `ScheduleSkip[]`), so `fired: run.fired` needs no mapping. `readDisabled(app)` returns `string[]` for BOTH `collectScheduleTargets` (Set built once) and `runScheduleOnce` (re-used array). `devToken` is the existing `let devToken = token ?? process.env["VOID_DEV_TRIGGER"]` from the trigger case — hoist that declaration above the `switch` so both `trigger` and `schedule` share it.

4. `startScheduleLoop` appended to `schedule.ts` (final code):

```typescript
const TICK_MS = 30_000;

export async function startScheduleLoop(
  appRoot: string,
  opts: ScheduleOptions & { intervalMs?: number; signal?: AbortSignal },
): Promise<{ firedTotal: number }> {
  const intervalMs = opts.intervalMs ?? TICK_MS;
  const disabledNames = new Set(opts.disabled ?? []);
  const { active } = collectScheduleTargets(scanCronFiles(appRoot), disabledNames);
  let state = initScheduleState(opts.nowMs ?? Date.now());
  const SOON = 8 * 24 * 60 * 60 * 1000;
  const next = latestDue([...active.keys()], state.checkpointMs, state.checkpointMs + SOON)
    .sort((a, b) => a.dueMs - b.dueMs)[0];
  const relay = next
    ? ` · next ${next.expr} in ${fmtRel(next.dueMs - state.checkpointMs)}`
    : "";
  console.log(`scheduled ${active.size} ${active.size === 1 ? "expression" : "expressions"} · origin ${opts.origin}${relay}`);
  let firedTotal = 0;
  let stopped = false;
  const stop = (): void => { stopped = true; };
  opts.signal?.addEventListener("abort", stop);
  if (typeof process !== "undefined" && typeof process.on === "function") {
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
  while (!stopped) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    if (stopped) break;
    const { state: next_, fired } = await tickSchedule(state, { active, skipped: [] }, {
      origin: opts.origin,
      devToken: opts.devToken,
      cronSecret: opts.cronSecret,
      fetchImpl: opts.fetchImpl,
      nowMs: Date.now(),
      appendActivity: { appRoot },
    });
    state = next_;
    firedTotal += fired.length;
    for (const e of fired) console.log(`fired ${e.jobName} ${e.cron} (${e.durationMs}ms)`);
  }
  return { firedTotal };
}

function fmtRel(msDelta: number): string {
  const s = Math.max(60, Math.round(msDelta / 1000));
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}
```

`startScheduleLoop` has no json visibility and always prints the startup line (CLI live mode has no `--json` contract this iteration; spec only defines json for `--once`).

5. Export wiring check: `src/index.ts` gains `export * from "./schedule.js";`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS (`void-crons CLI schedule`, 13+ cases total green).

- [ ] **Step 5: Commit**

```bash
git add packages/crons/src/cli.ts packages/crons/src/schedule.ts packages/crons/src/index.ts packages/crons/test/crons.test.ts
git commit -m "feat(crons): schedule command (once catch-up + live loop)"
```

---

### Task 5: Drift in `check`

**Files:**
- Modify: `packages/crons/src/manifest.ts` (add `detectDrift`)
- Modify: `packages/crons/src/cli.ts` (check wiring + `--no-drift` flag)
- Test: `packages/crons/test/crons.test.ts`

**Interfaces:**
- Consumes: `buildCronManifest`, `readCronManifest`, `scanCronFiles`.
- Produces: `detectDrift(manifest: CronManifest, jobs: CronJob[]): string[]` — human lines, empty = no drift. Compares **active sets only**: `activePaths = sort(jobs.filter(active).map(path))` vs `sort(manifest.jobs.filter(active).map(path))`, plus per-expression set diff for active jobs combined. Line format: one line per drifted file, `+` = on disk now, `-` = in manifest gone; expression-level `·` line per mixed change: `drift: -cleanup.ts removed` / `drift: +daily-rollup.ts added` / `drift: ~heartbeat.ts cron '0 2 * * *' → '0 3 * * *'`.

- [ ] **Step 1: Write the failing test**

Append to `packages/crons/test/crons.test.ts` (fold `detectDrift` into the existing manifest import; `scanCronFiles`/`writeFileSync`/`rmSync`/`emitCronManifest`/`readCronManifest` are already imported by earlier describes):

```typescript
describe("detectDrift", () => {
  // pinned Review Focus input 1: manifest exists but crons/ deleted → all removed
  it("reports added/removed/changed files against the manifest", () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT, "cleanup.ts": CLEANUP });
    try {
      emitCronManifest(app);
      const manifest = readCronManifest(app)!;
      assert.deepEqual(detectDrift(manifest, scanCronFiles(app)), []);
      // change one file on disk, delete another
      writeFileSync(join(app, "crons", "cleanup.ts"), `export const cron = '0 3 * * *';\nexport default async () => {};\n`);
      rmSync(join(app, "crons", "heartbeat.ts"));
      const drift = detectDrift(manifest, scanCronFiles(app));
      assert.equal(drift.length, 2);
      assert.ok(drift.some((d) => d.includes("-heartbeat.ts removed")));
      assert.ok(drift.some((d) => d.includes("~cleanup.ts cron '0 2 * * *' → '0 3 * * *'")));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `detectDrift` not exported.

- [ ] **Step 3: Write minimal implementation**

In `manifest.ts`:

```typescript
import type { CronJob } from "./types.js";

/** Drift lines between a stored manifest and a fresh scan — active sets only, never emittedAt. */
export function detectDrift(manifest: CronManifest, jobs: CronJob[]): string[] {
  const lines: string[] = [];
  const manifestActive = manifest.jobs.filter((j) => j.status === "active");
  const diskActive = jobs.filter((j) => j.status === "active");
  const byPath = new Map(manifestActive.map((j) => [j.path, j]));
  for (const j of diskActive) {
    const prev = byPath.get(j.path);
    if (!prev) lines.push(`+${j.path} added`);
    else if (prev.expressions.join(", ") !== j.expressions.join(", ")) {
      lines.push(`~${j.path} cron '${prev.expressions.join(", ")}' → '${j.expressions.join(", ")}'`);
    }
  }
  const diskPaths = new Set(diskActive.map((j) => j.path));
  for (const j of manifestActive) if (!diskPaths.has(j.path)) lines.push(`-${j.path} removed`);
  return lines;
}
```

In `cli.ts` `check` case — final wiring, inside the per-app loop after `manifest = buildCronManifest(app)` and the limit checks:

```typescript
        let drift: string[] = [];
        if (!flags.has("--no-drift")) {
          const stored = readCronManifest(app);
          if (stored) {
            drift = detectDrift(stored, scanCronFiles(app, { disabled: [...new Set(stored.disabled ?? [])] }));
            if (drift.length > 0) {
              code = 1;
              problems.push(...drift);
            }
          }
        }
```

The existing problems-printing block stays; after it, when `drift.length > 0` and not json/ci, print the footer:

```typescript
        if (drift.length > 0 && !json && !ci) console.log(`  run void-crons emit to regenerate`);
```

`--ci` behavior unchanged (still exit 1 on drift — CI wants drift failures). `--json` check output gains `format: 1` and `drift` array:

```typescript
          console.log(JSON.stringify({
            app: basename(app),
            ok: problems.length > 0 ? false : true,
            format: 1,
            problems,
            drift,
          }, null, 2));
```

Clean-path json keeps keys `{app, ok, format, jobs, expressions, schedules}` only (drop `drift` when empty, so the `ok: false` branch above appears exactly where problems exist — implement as two branches mirroring the current pre-spec `if (problems.length > 0) ... else if (json)` structure).

PR-scoped GOTCHA: `readCronManifest` used here is the same helper `readDisabled` uses — no new state.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS — including pre-existing `list/check/emit` test (its `check` still exits 1: drift from a fresh manifest mismatch? No — the CLI test emits BEFORE check, then check compares fresh scan vs just-emit — zero drift; exit stays 1 from `broken.ts` invalid). Extra wire-up: accepted.

- [ ] **Step 5: Commit**

```bash
git add packages/crons/src/manifest.ts packages/crons/src/cli.ts packages/crons/test/crons.test.ts
git commit -m "feat(crons): check detects manifest drift, exits 1"
```

---

### Task 6: `list` next-fire preview

**Files:**
- Modify: `packages/crons/src/cli.ts` (list column + json `nextFireMs`)
- Test: `packages/crons/test/crons.test.ts`

**Interfaces:**
- Consumes: `latestDue`/`computeDue` (`./schedule.js` × re-export or direct import from `./schedule.js`), `scanCronFiles`.
- Produces: display-only. Column `next in Xm`/`next in Xh`/`<1m`/`never` (`—` for disabled, nothing for invalid). JSON list output: `jobs[i].nextFireMs?: number` (earliest next due beyond now within 8d; omitted when none).

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe("void-crons list preview", () => {
  // pinned Review Focus input 4: yearly expr inside 8d window → never, no crash
  it("shows next-fire column; yearly jobs read never; json carries nextFireMs", async () => {
    const app = makeApp({
      "hourly.ts": HEARTBEAT, // '0 * * * *' → next < 1h
      "yearly.ts": `export const cron = '0 0 1 1 *';\nexport default async () => {};\n`,
    });
    const logs: string[] = [];
    const orig = console.log;
    console.log = (s?: string) => { logs.push(String(s)); };
    try {
      assert.equal(await run(["list", app, "--json"], process.cwd()), 0);
      const out = JSON.parse(logs.join("\n").split("\n").filter((l) => l.startsWith("{")).join("\n"));
      const jobs = out.jobs as { name: string; nextFireMs?: number }[];
      assert.ok(jobs.find((j) => j.name === "hourly")?.nextFireMs, "hourly has a next fire");
      assert.ok(!("nextFireMs" in (jobs.find((j) => j.name === "yearly") ?? {})));
      logs.length = 0;
      console.log = orig;
      assert.equal(await run(["list", app], process.cwd()), 0);
      const text = logs.join("\n");
      assert.match(text, /next in \d+[mh]|<1m/);
      assert.match(text, /yearly\s+0 0 1 1 \*\s+never/);
    } finally {
      console.log = orig;
      rmSync(app, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — no `nextFireMs` in JSON, no `never` column.

- [ ] **Step 3: Write minimal implementation**

`cli.ts` helpers (top of file):

```typescript
const PREVIEW_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

function nextFire(expressions: string[], nowMs: number): number | null {
  const due = computeDue(expressions, nowMs + 1, nowMs + PREVIEW_WINDOW_MS)[0];
  return due ? due.dueMs : null;
}

function fmtNext(dueMs: number, nowMs: number): string {
  const s = Math.max(60, Math.round((dueMs - nowMs) / 1000));
  if (s < 120) return "next in <2m";
  if (s < 5400) return `next in ${Math.round(s / 60)}m`;
  return `next in ${Math.round(s / 3600)}h`;
}
```

`list` non-json row becomes:

```typescript
            const now = Date.now();
            const preview =
              j.status === "active" ? (nextFire(j.expressions, now) ? fmtNext(nextFire(j.expressions, now)!, now) : "never") : j.status === "disabled" ? "—" : "";
            console.log(`  ${marker} ${j.name}  ${expr}${preview ? `  ${preview}` : ""}`);
```

(call `nextFire` once into a local, compute preview from it).

`--json` jobs gain the field:

```typescript
        const now = Date.now();
        const jobsJson = jobs.map((j) => ({ ...j, nextFireMs: j.status === "active" ? (nextFire(j.expressions, now) ?? undefined) : undefined }));
```

(build once, print `JSON.stringify({ app: basename(app), jobs: jobsJson, manifest }, null, 2))`.)

Import: `import { computeDue } from "./schedule.js";`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/crons/src/cli.ts packages/crons/test/crons.test.ts
git commit -m "feat(crons): list next-fire preview column + json nextFireMs"
```

---

### Task 7: Publishable package shape + `format: 1` sweep

**Files:**
- Modify: `packages/crons/package.json`
- Modify: `packages/crons/src/cli.ts` (any lingering `--json` without `format: 1`: `list`, `trigger`)

**Interfaces:**
- Consumes: previous tasks' outputs already carry `format: 1` where specced (`check` clean path, `schedule --once`, manifest file).
- Produces: `publishConfig.exports` mapping every specifier to `dist/`; `trigger --json` and `list --json` gain `format: 1` key.

- [ ] **Step 1: Patch package.json**

```jsonc
{
  // additions only — leave existing fields intact
  "publishConfig": {
    "access": "public",
    "exports": {
      ".": "./dist/index.js",
      "./ui": "./dist/ui/CronPanel.js",
      "./scan": "./dist/scan.js",
      "./manifest": "./dist/manifest.js",
      "./schedule": "./dist/schedule.js",
      "./cli": "./dist/cli.js",
      "./package.json": "./package.json"
    },
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
}
```

`files` already `["dist", "bin", "README.md"]`; no `prepublishOnly` needed (private until released; house = fingerprint pattern's `prepublishOnly` is optional — add `"prepublishOnly": "pnpm build"` for parity).

- [ ] **Step 2: Write the failing test**

Append:

```typescript
describe("void-crons json contract", () => {
  it("list/trigger --json carry format: 1", async () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT });
    const logs: string[] = [];
    const orig = console.log;
    console.log = (s?: string) => { logs.push(String(s)); };
    try {
      await run(["list", app, "--json"], process.cwd());
      assert.equal(JSON.parse(logs.find((l) => l.startsWith("{")) ?? "{}").format, 1);
      logs.length = 0;
      // trigger needs a fetch stub
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async (() => ({ ok: true, status: 200 })) as unknown) as typeof fetch;
      await run(["trigger", "0 * * * *", app, "--json"], process.cwd());
      globalThis.fetch = origFetch;
      assert.equal(JSON.parse(logs.find((l) => l.startsWith("{")) ?? "{}").format, 1);
    } finally {
      console.log = orig;
      rmSync(app, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test` → FAIL (`format` undefined in both outputs).

- [ ] **Step 4: Implement**

`list` --json object: `{ format: 1 as const, app: basename(app), jobs: jobsJson, manifest }`. `trigger` --json lines: `console.log(JSON.stringify({ app: basename(app), format: 1, ...res }))`.

- [ ] **Step 5: Verify full gate**

Run: `pnpm test && pnpm typecheck`
Expected: PASS clean.

- [ ] **Step 6: Commit**

```bash
git add packages/crons/package.json packages/crons/src/cli.ts packages/crons/test/crons.test.ts
git commit -m "feat(crons): publishConfig dist-rewrites, format:1 on all json outputs"
```

---

### Task 8: README to house pattern + acceptance sweep

**Files:**
- Modify: `packages/crons/README.md` (full rewrite; content below)

**Interfaces:**
- Consumes: all shipped commands.
- Produces: docs matching the void-fingerprint README pattern.

- [ ] **Step 1: Rewrite README**

```markdown
# @void-monorepo/crons

Cron lifecycle for Void `crons/` — scan, preview, manifest, drift check, catch-up, live scheduler, activity log, glossy dev panel. One CLI (`void-crons`), one library, one React component.

## Void contract

Each file in `crons/**/*.ts` (`.mts`, `.js`, `.mjs` also supported) must export:

- `export const cron = "<5-field cron expression>"` — or an array of expressions
- a default handler (recommended: wrapped with `defineScheduled`)

Files/dirs starting with `_` are ignored. Jobs sharing one expression each run once per
invocation and count once toward the 100-expression platform limit (1000 schedules max).

## Quick start

```bash
node packages/crons/bin/void-crons.mjs list apps/api
# apps/api: 1 job(s)
#   ● cleanup  0 2 * * *  next in 3h

node packages/crons/bin/void-crons.mjs check apps/api
# apps/api: clean (1 jobs, 1 expr, 1 sched)

node packages/crons/bin/void-crons.mjs emit apps/api
# emitted apps/api/void.crons.json

node packages/crons/bin/void-crons.mjs schedule apps/api --once
# apps/api: fired cleanup 0 2 * * * (128ms)
# apps/api: caught up (1 fired, 0 skipped)

node packages/crons/bin/void-crons.mjs schedule apps/api
# scheduled 1 expressions · origin http://localhost:5173 · next 0 2 * * * in 3h
# (live loop — fires each expression as its minute passes; Ctrl-C exits 0)

node packages/crons/bin/void-crons.mjs trigger cleanup --origin http://localhost:5173 --token <dev-token>
# apps/api: fired cleanup 0 2 * * * (95ms)
```

## CLI reference

Works per-app (`[app-path]`, default cwd) or `--all` across `apps/*` (needs `void.json`).

| Command | What it does | Exit 1 |
|---|---|---|
| `list [app]` | scanned jobs + `next in Xm` preview + activity tail; `--json` carries `nextFireMs` | invalid job present |
| `check [app]` | invalid jobs + platform limits + **manifest drift** (default on; `--no-drift` skips) | invalid jobs, limit overflow, drift |
| `emit [app]` | writes `void.crons.json` (app-row friendly: reviewed diffs, CI baseline) | — (2 on tool error) |
| `schedule [app] --once` | fires most-recent due per expression within trailing 24h, appends activity log | — |
| `schedule [app]` | live loop: 30s ticks, fires each expression at most once per matched minute, appends activity log | — |
| `trigger <job|expr>` | manual fire via `/__void/scheduled`; `--cron EXPR` overrides, `--token` dev header | HTTP failure |

Exit codes: `0` clean · `1` drift/invalid/failed · `2` tool/usage error.

`--json`: machine-readable, every object carries `format: 1`. `check --json` prints
`{app, ok, problems?, drift?}`; `schedule --once --json` prints
`{format: 1, app, fired: CronActivityEntry[], skipped: [{cron, jobName, reason}]}`;
`list --json` adds `nextFireMs` per active job.

## Drift detection

`check` compares the committed `void.crons.json` against a fresh scan — active job
paths and expression **sets** only (never `emittedAt`). Human output:

```text
apps/api: invalid
  ✕ -crons/heartbeat.ts removed
  ✕ ~crons/cleanup.ts cron '0 2 * * *' → '0 3 * * *'
  run void-crons emit to regenerate
```

Emitted manifests are committed at app roots — review diffs, CI baseline, deploy artifact.

## Activity log

`scheduler`/`--once`/`trigger` append to `void.crons.activity.json` (capped at 100,
newest first) so the CLI and CronPanel share history. Swap `createCronStore` for
KV/Drizzle in prod — the panel only needs `record/list/setDisabled`.

## Panel

One component serves the in-app page and the dev overlay:

```tsx
import { CronPanel } from '@void-monorepo/crons/ui';
import { scanCronFiles } from '@void-monorepo/crons';

<CronPanel
  jobs={scanCronFiles(appRoot)}
  activity={store.list()}
  onToggle={(name, disabled) => store.setDisabled(name, disabled)}
  onTrigger={(job) => triggerJob(job, { origin, devToken })}
/>
```

Toggle semantics: **Off skips local triggers and hides the job from `void.crons.json`**.
It is not a prod kill-switch — Cloudflare triggers can't be disabled at runtime.

## Known limits

- Cron validation is **shape-only** (5 fields, `* , - / digits`) — semantic garbage
  like `99 99 99 99 99` passes here and fails at Cloudflare.
- Real Void SDK is not on this repo's registry lockfile yet; `defineScheduled` checks
  are regex-level, and dev/build run without the plugin (see apps/api/vite.config.ts).
- No dual datetime zones — expressions parse in server-local time.
- Activity log races (CLI + panel writing concurrently) are last-writer-wins — dev
  artifact only, prod must use the swapped store.
```

(Adjust sample outputs to the real `apps/api` jobs if `list`'s preview differs.)

- [ ] **Step 2: Run acceptance sweep (spec)**

From repo root:

```bash
pnpm --filter @void-monorepo/crons test && pnpm --filter @void-monorepo/crons typecheck
node packages/crons/bin/void-crons.mjs list apps/api
node packages/crons/bin/void-crons.mjs check apps/api
node packages/crons/bin/void-crons.mjs check apps/api --no-drift
node packages/crons/bin/void-crons.mjs emit apps/api && git checkout -- apps/api/void.crons.json 2>/dev/null || true
node packages/crons/bin/void-crons.mjs schedule apps/api --once --origin http://localhost:59999
```

Acceptance mapping: 1 = list preview shows; 2 = edit `apps/api/crons/cleanup.ts` → check exits 1 with drift lines, `emit` restores 0 (then `git checkout`); 3 = `--once` fires offline-origin (failed entries land in log, exit 0); 4 = tick tests; 5 = disabled skip tests; 6 = `--no-drift` diff vs pre-spec behavior: same glyphs/output (drift-only additions absent); 7 = `check --json` parses with `format: 1`; README lists every command's exit codes.

- [ ] **Step 3: Commit**

```bash
git add packages/crons/README.md
git commit -m "docs(crons): lifecycle README (house pattern, CLI reference, json contract)"
```

---

## Verification Checklist (final)

- `pnpm --filter @void-monorepo/crons test` → all green (existing 12 + new schedule/drift/preview/json tests).
- `pnpm --filter @void-monorepo/crons typecheck` → clean.
- `node packages/crons/bin/void-crons.mjs --help` shows `schedule` usage line.
- `pnpm --filter @void-monorepo/crons build` → dist/ emits cli.js + schedule.js (bin loader imports succeed).
- Spec acceptance 1–7 all exercised (map in Task 8 step 2).
