import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { MAX_EXPRESSIONS, MAX_SCHEDULES, buildCronManifest, detectDrift, emitCronManifest, readCronManifest } from "./manifest.js";
import { appendActivityLog, readActivityLog, type ActivityStoreMode } from "./store.js";
import type { CronActivityEntry } from "./types.js";
import { computeDue, isValidTimezone, runScheduleOnce, startScheduleLoop } from "./schedule.js";
import { triggerExpression, triggerJob } from "./trigger.js";
import { isCronExpression, scanCronFiles } from "./scan.js";

const USAGE = [
  "usage: void-crons <list|check|emit|trigger|schedule> [app-path] [options]",
  "",
  "  list [app-path] [--json] [--all] [--tz ZONE]  scanned jobs + manifest state",
  "  check [app-path] [--all]                      fail (1) on invalid jobs or limit overflow",
  "  emit [app-path]                               write void.crons.json",
  "  trigger <job|expr> [app-path] [--origin URL] [--cron EXPR] [--token T] [--retries N] [--timeout MS] [--all]",
  "  schedule [app-path] [--once] [--token T] [--tz ZONE] [--retries N] [--timeout MS] [--store sqlite|jsonl]  catch-up (--once) or live auto-fire loop",
  "",
  "  --origin URL   dev server origin (default http://localhost:5173)",
  "  --cron EXPR    expression to fire when triggering by job name",
  "  --token T      x-void-dev-trigger value (else --dev-token is omitted)",
  "  --tz ZONE      IANA timezone for schedule + previews (default server-local)",
  "  --retries N    retry attempts on 429/5xx/network (default 0); backoff 500ms doubling",
  "  --timeout MS   per-attempt HTTP timeout (default 10000)",
  "  --store MODE   activity store: sqlite (WAL, default) or jsonl (legacy file)",
  "  --json         machine-readable output",
  "  --all          run across apps/* (needs void.json)",
  "  --ci           quiet on success",
].join("\n");

function hasVoidJson(dir: string): boolean {
  try {
    return statSync(join(dir, "void.json")).isFile();
  } catch {
    return false;
  }
}

function resolveApps(cwd: string, all: boolean, positional?: string): string[] {
  if (!all) return [positional ? resolve(cwd, positional) : cwd];
  const appsDir = cwd.endsWith("/apps") ? cwd : join(cwd, "apps");
  return readdirSync(appsDir)
    .map((d) => join(appsDir, d))
    .filter((p) => {
      try {
        return statSync(p).isDirectory() && hasVoidJson(p);
      } catch {
        return false;
      }
    })
    .sort();
}

export async function run(argv: string[], cwd: string): Promise<number> {
  const args = [...argv];
  const flags = new Set<string>();
  const positionals: string[] = [];
  let origin = "http://localhost:5173";
  let cronOverride: string | undefined;
  let token: string | undefined;
  let tz: string | undefined;
  let retries = 0;
  let timeoutMs = 10_000;
  let store: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--origin") {
      origin = args[i + 1] ?? origin;
      i++;
    } else if (a === "--cron") {
      cronOverride = args[i + 1];
      i++;
    } else if (a === "--token") {
      token = args[i + 1];
      i++;
    } else if (a === "--tz") {
      tz = args[i + 1];
      i++;
    } else if (a === "--retries") {
      retries = Math.max(0, Number.parseInt(args[i + 1] ?? "0", 10) || 0);
      i++;
    } else if (a === "--timeout") {
      timeoutMs = Math.max(1, Number.parseInt(args[i + 1] ?? "10000", 10) || 10_000);
      i++;
    } else if (a === "--store") {
      store = args[i + 1];
      i++;
    } else if (a.startsWith("--")) {
      flags.add(a);
    } else {
      positionals.push(a);
    }
  }
  if (flags.has("--help") || positionals[0] === "help" || args.includes("-h")) {
    console.log(USAGE);
    return 2;
  }
  const cmd = positionals[0] ?? "list";
  // trigger takes the job selector first, then an optional app path:
  // `trigger <job|expr> [app-path]`. All other commands take `[app-path]` first.
  const target = cmd === "trigger" ? positionals[2] : positionals[1];
  const triggerSelector = cmd === "trigger" ? positionals[1] : undefined;
  const all = flags.has("--all");
  const json = flags.has("--json");
  const ci = flags.has("--ci");

  let apps: string[];
  try {
    apps = resolveApps(cwd, all, target);
  } catch (e) {
    console.log(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  if (tz !== undefined && !isValidTimezone(tz)) {
    console.log(`error: unknown timezone: "${tz}" (expected IANA name like America/New_York)`);
    return 2;
  }
  const storeMode: ActivityStoreMode = store === undefined ? "sqlite" : store === "sqlite" || store === "jsonl" ? store : "sqlite";
  if (store !== undefined && store !== "sqlite" && store !== "jsonl") {
    console.log(`error: unknown store: "${store}" (expected sqlite or jsonl)`);
    return 2;
  }
  switch (cmd) {
    case "list": {
      let code = 0;
      for (const app of apps) {
        const jobs = scanCronFiles(app, { disabled: readDisabled(app) });
        const manifest = readCronManifest(app);
        const now = Date.now();
        const jobsJson = jobs.map((j) => ({
          ...j,
          nextFireMs: j.status === "active" ? (nextFire(j.expressions, now, tz) ?? undefined) : undefined,
        }));
        if (json) {
          console.log(JSON.stringify({ app: basename(app), format: 1, tz: tz ?? null, jobs: jobsJson, manifest }, null, 2));
        } else {
          console.log(`${basename(app)}: ${jobs.length} job(s)${tz ? ` (tz ${tz})` : ""}`);
          for (const j of jobs) {
            const expr = j.status === "invalid" ? (j.error ?? "invalid") : j.expressions.join(", ");
            const marker = j.status === "active" ? "●" : j.status === "disabled" ? "○" : "✕";
            const due = j.status === "active" ? nextFire(j.expressions, now, tz) : null;
            const preview = due !== null ? fmtNext(due, now) : j.status === "active" ? "never" : j.status === "disabled" ? "—" : "";
            console.log(`  ${marker} ${j.name}  ${expr}${preview ? `  ${preview}` : ""}`);
          }
          if (!manifest && !ci) console.log("  (no void.crons.json — run void-crons emit)");
          if (manifest) {
            const activity = readActivityLog(app, 5, storeMode);
            for (const entry of activity) {
              console.log(`  ↳ ${entry.jobName} ${entry.cron} ${entry.status} ${(entry.durationMs / 1000).toFixed(1)}s`);
            }
          }
        }
        if (jobs.some((j) => j.status === "invalid")) code = 1;
      }
      return code;
    }
    case "check": {
      let code = 0;
      for (const app of apps) {
        let manifest;
        try {
          manifest = buildCronManifest(app);
        } catch (e) {
          console.log(`${basename(app)}: error: ${e instanceof Error ? e.message : String(e)}`);
          code = 2;
          continue;
        }
        const problems: string[] = manifest.invalid.map((v) => `${v.path}: ${v.error}`);
        if (manifest.expressionCount > MAX_EXPRESSIONS) {
          problems.push(`${manifest.expressionCount}/${MAX_EXPRESSIONS} distinct expressions (platform limit)`);
        }
        if (manifest.scheduleCount > MAX_SCHEDULES) {
          problems.push(`${manifest.scheduleCount}/${MAX_SCHEDULES} schedules (platform limit)`);
        }
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
        if (problems.length > 0) {
          code = 1;
          if (json) console.log(JSON.stringify({ app: basename(app), ok: false, format: 1, problems, drift }, null, 2));
          else {
            console.log(`${basename(app)}: invalid`);
            for (const p of problems) console.log(`  ✕ ${p}`);
          }
          if (drift.length > 0 && !json && !ci) console.log(`  run void-crons emit to regenerate`);
        } else if (json) {
          console.log(
            JSON.stringify({
              app: basename(app),
              ok: true,
              format: 1,
              jobs: manifest.jobs.length,
              expressions: manifest.expressionCount,
              schedules: manifest.scheduleCount,
            }),
          );
        } else if (!ci) {
          console.log(
            `${basename(app)}: clean (${manifest.jobs.length} jobs, ${manifest.expressionCount} expr, ${manifest.scheduleCount} sched)`,
          );
        }
      }
      return code;
    }
    case "emit": {
      try {
        for (const app of apps) {
          const { path } = emitCronManifest(app);
          if (!ci) console.log(`emitted ${path}`);
        }
        return 0;
      } catch (e) {
        console.log(`error: ${e instanceof Error ? e.message : String(e)}`);
        return 2;
      }
    }
    case "trigger": {
      const selector = triggerSelector;
      if (!selector) {
        console.log(`error: trigger needs a job name or cron expression\n${USAGE}`);
        return 2;
      }
      const devToken = token ?? process.env["VOID_DEV_TRIGGER"];
      let code = 0;
      for (const app of apps) {
        const jobs = scanCronFiles(app, { disabled: readDisabled(app) });
        const byName = jobs.find((j) => j.name === selector || j.path === selector);
        if (byName) {
          const wanted = cronOverride ? [cronOverride] : byName.expressions;
          if (wanted.length === 0) {
            console.log(`${basename(app)}: skip ${byName.name}: ${byName.error ?? "no expression"}`);
            code = 1;
            continue;
          }
          const fired: CronActivityEntry[] = [];
          for (const expression of wanted) {
            const res = await triggerExpression(expression, byName.name, {
              origin,
              devToken,
              timeoutMs,
              maxAttempts: retries + 1,
            });
            if (res.entry) fired.push(res.entry);
            if (json) console.log(JSON.stringify({ app: basename(app), format: 1, ...res }));
            else if (res.ok) console.log(`${basename(app)}: fired ${byName.name} ${expression} (${res.entry?.durationMs}ms)`);
            else {
              code = 1;
              console.log(`${basename(app)}: failed ${byName.name} ${expression}: ${res.entry?.error ?? res.reason ?? "unknown"} (HTTP ${res.httpStatus ?? 0}, attempts ${res.attempts})`);
            }
          }
          appendActivityLog(app, fired, storeMode);
          continue;
        }
        // Raw expression: fire it directly (matches Void's dev endpoint semantics).
        const job = jobs.flatMap((j) => j.expressions.map((e) => ({ job: j, expression: e }))).find(
          (x) => x.expression === selector,
        );
        if (!job && !isCronExpression(selector)) {
          console.log(`error: no job "${selector}" in ${basename(app)} (${basename(app)} scanned ${jobs.length} jobs) and selector is not a 5-field cron expression\nrun from the app dir, or use trigger <job> --all`);
          code = 1;
          continue;
        }
        const name = job?.job.name ?? selector;
        const stub = job?.job ?? {
          path: selector,
          name,
          expressions: [selector],
          status: "active",
          usesDefineScheduled: false,
          sharedExpression: false,
        };
        const results = await triggerJob({ ...stub, expressions: [selector] }, { origin, devToken, timeoutMs, maxAttempts: retries + 1 });
        const fired: CronActivityEntry[] = results.flatMap((r) => (r.entry ? [r.entry] : []));
        for (const res of results) {
          if (json) console.log(JSON.stringify({ app: basename(app), format: 1, ...res }));
          else if (res.ok) console.log(`${basename(app)}: fired ${name} ${selector} (${res.entry?.durationMs ?? 0}ms)`);
          else {
            code = 1;
            console.log(`${basename(app)}: failed ${name} ${selector}: ${res.entry?.error ?? res.reason ?? "unknown"} (attempts ${res.attempts})`);
          }
        }
        appendActivityLog(app, fired, storeMode);
      }
      return code;
    }
    case "schedule": {
      const devToken = token ?? process.env["VOID_DEV_TRIGGER"];
      if (apps.length > 1 && !flags.has("--once")) {
        console.log(`error: live schedule runs one app at a time — pass an app path (batch catch-up: schedule --all --once)\n${USAGE}`);
        return 2;
      }
      let code = 0;
      for (const app of apps) {
        const disabled = new Set(readDisabled(app));
        const jobs = scanCronFiles(app, { disabled: [...disabled] });
        if (!ci) {
          for (const j of jobs.filter((x) => x.status === "invalid")) {
            console.log(`${basename(app)}: ✕ ${j.error ?? "invalid job"}`);
          }
        }
        if (flags.has("--once")) {
          // runScheduleOnce re-scans with the same disabled set — its skipped list is authoritative.
          const runOnceResult = await runScheduleOnce(app, {
            origin,
            devToken,
            disabled: [...disabled],
            tz,
            timeoutMs,
            maxAttempts: retries + 1,
            store: storeMode,
          });
          if (json) {
            console.log(JSON.stringify(
              {
                format: 1 as const,
                app: basename(app),
                tz: tz ?? null,
                fired: runOnceResult.fired,
                skipped: runOnceResult.skipped,
              },
              null,
              2,
            ));
          } else {
            for (const e of runOnceResult.fired) console.log(`${basename(app)}: fired ${e.jobName} ${e.cron} (${e.durationMs}ms)`);
            for (const s of runOnceResult.skipped) console.log(`${basename(app)}: skip ${s.reason}`);
            if (!ci) console.log(`${basename(app)}: caught up (${runOnceResult.fired.length} fired, ${runOnceResult.skipped.length} skipped)`);
          }
          continue;
        }
        await startScheduleLoop(app, { origin, devToken, disabled: [...disabled], tz, timeoutMs, maxAttempts: retries + 1, store: storeMode });
      }
      return code;
    }
    default: {
      console.log(USAGE);
      return 2;
    }
  }
}

function readDisabled(app: string): string[] {
  const manifest = readCronManifest(app);
  return manifest?.disabled ?? [];
}

const PREVIEW_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

function nextFire(expressions: string[], nowMs: number, tz?: string): number | null {
  const due = computeDue(expressions, nowMs + 1, nowMs + PREVIEW_WINDOW_MS, { tz })[0];
  return due ? due.dueMs : null;
}

function fmtNext(dueMs: number, nowMs: number): string {
  const s = Math.max(60, Math.round((dueMs - nowMs) / 1000));
  if (s < 120) return "next in <2m";
  if (s < 5400) return `next in ${Math.round(s / 60)}m`;
  return `next in ${Math.round(s / 3600)}h`;
}
