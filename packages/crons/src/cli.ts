import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { MAX_EXPRESSIONS, MAX_SCHEDULES, buildCronManifest, detectDrift, emitCronManifest, readCronManifest } from "./manifest.js";
import { appendActivityLog, readActivityLog, type ActivityStoreMode } from "./store.js";
import type { CronActivityEntry, CronTriggerOptions } from "./types.js";
import { nextDue, isValidTimezone, runScheduleOnce, startScheduleLoop } from "./schedule.js";
import { resolveTriggerTarget, triggerExpression, triggerJob } from "./trigger.js";
import { findVoidConfig, inspectProject } from "./project.js";
import { readProductionEvidence, writeProductionEvidence } from "./production.js";
import type { CronProductionEvidence } from "./evidence.js";
import { isCronExpression, scanCronFiles } from "./scan.js";
import { allPreviewSupported } from "./cron-expr.js";
import { startTui, type TuiOptions } from "./tui/run.js";

const USAGE = [
  "usage: void-crons <list|check|emit|trigger|schedule|ui|doctor|verify> [app-path] [options]",
  "",
  "  list [app-path] [--json] [--all] [--tz ZONE]  scanned jobs + manifest state",
  "  ui [app-path] [--tz ZONE] [--store sqlite|jsonl] [--origin URL] [--token T] [--retries N] [--timeout MS]  interactive dashboard + actions",
  "  check [app-path] [--all]                      fail (1) on invalid jobs or limit overflow",
  "  emit [app-path]                               write local inspection artifact (not consumed by void deploy)",
  "  doctor [app-path] [--json] [--all] [--evidence FILE]  SDK/config and capability boundaries",
  "  verify [app-path] --origin URL --transport framework --cron EXPR --evidence FILE --allow-remote --confirm-remote-write  write production proof",
  "  trigger <job|expr> [app-path] [--origin URL] [--cron EXPR] [--token T] [--retries N] [--timeout MS] [--all]",
  "  schedule [app-path] [--once] [--token T] [--tz ZONE] [--retries N] [--timeout MS] [--store sqlite|jsonl]  catch-up (--once) or live auto-fire loop",
  "",
  "  --origin URL   dev server origin (default http://localhost:5173)",
  "  --cron EXPR    expression to fire when triggering by job name",
  "  --token T      x-void-dev-trigger value (default: $VOID_DEV_TRIGGER; no token when unset)",
  "  --tz ZONE      IANA timezone for schedule + previews (default UTC, matching Cloudflare)",
  "  --retries N    retry attempts on 429/5xx/network (default 0); backoff 500ms doubling",
  "  --timeout MS   per-attempt HTTP timeout (default 10000)",
  "  --store MODE   activity store: sqlite (WAL, default) or jsonl (legacy file)",
  "  --json         machine-readable output",
  "  --all          run across apps/* with void.config.* or void.json",
  "  --transport dev|framework  dev is loopback-only; framework requires --allow-remote and CRON_SECRET",
  "  --allow-remote  explicit consent for framework dispatch (not endpoint verification)",
  "  --confirm-remote-write  required by verify before any remote job dispatch",
  "  --evidence FILE  production verification proof used by doctor/trigger",
  "  --binding-mode local|remote|unknown  caller assertion; remote requires --allow-remote-bindings",
  "  --allow-remote-bindings  consent when binding mode is asserted remote",
  "  --limits managed|none  managed quota profile (default), or external limits checked separately",
  "  --ci           quiet on success",
].join("\n");

function resolveApps(cwd: string, all: boolean, positional?: string): string[] {
  if (!all) return [positional ? resolve(cwd, positional) : cwd];
  const appsDir = cwd.endsWith("/apps") ? cwd : join(cwd, "apps");
  return readdirSync(appsDir)
    .map((d) => join(appsDir, d))
    .filter((p) => {
      try {
        return statSync(p).isDirectory() && findVoidConfig(p) !== undefined;
      } catch {
        return false;
      }
    })
    .sort();
}

export async function run(
  argv: string[],
  cwd: string,
  ui: (opts: TuiOptions) => Promise<number> = startTui,
): Promise<number> {
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
  let evidencePath: string | undefined;
  let transport: string = "dev";
  let bindingMode: string = "unknown";
  let limits = "managed";
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
    } else if (a === "--transport") {
      transport = args[++i] ?? "";
    } else if (a === "--binding-mode") {
      bindingMode = args[++i] ?? "";
    } else if (a === "--limits") {
      limits = args[++i] ?? "";
    } else if (a === "--store") {
      store = args[i + 1];
      i++;
    } else if (a === "--evidence") {
      evidencePath = args[i + 1];
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
  const allowRemote = flags.has("--allow-remote");
  let productionEvidence: CronProductionEvidence | undefined;
  if (evidencePath && cmd !== "verify") {
    try {
      productionEvidence = readProductionEvidence(evidencePath);
    } catch (error) {
      console.log(`error: ${error instanceof Error ? error.message : "invalid production evidence"}`);
      return 2;
    }
  }
  if (!["dev", "framework"].includes(transport) || !["local", "remote", "unknown"].includes(bindingMode) || !["managed", "none"].includes(limits)) {
    console.log("error: invalid transport, binding-mode, or limits profile");
    return 2;
  }
  const triggerOptions: CronTriggerOptions = {
    origin,
    transport: transport as "dev" | "framework",
    allowRemote,
    ...(productionEvidence ? { productionEvidence } : {}),
    bindingMode: bindingMode as "local" | "remote" | "unknown",
    allowRemoteBindings: flags.has("--allow-remote-bindings"),
    devToken: token ?? process.env["VOID_DEV_TRIGGER"],
    cronSecret: transport === "framework" ? process.env["CRON_SECRET"] : undefined,
    timeoutMs,
    maxAttempts: retries + 1,
  };
  if (["trigger", "schedule", "ui", "verify"].includes(cmd)) {
    if (transport === "framework" && !allowRemote) {
      console.log("error: framework dispatch requires --allow-remote; verify the deployed endpoint and internal-token authorization first");
      return 2;
    }
    if (cmd === "verify") {
      if (all) {
        console.log("error: verify is single-app");
        return 2;
      }
      if (transport !== "framework") {
        console.log("error: verify requires --transport framework");
        return 2;
      }
      if (!flags.has("--confirm-remote-write")) {
        console.log("error: verify dispatches a real remote job; pass --confirm-remote-write after checking the target");
        return 2;
      }
      if (!cronOverride || !evidencePath) {
        console.log("error: verify requires --cron EXPR and --evidence FILE");
        return 2;
      }
    }
    try {
      resolveTriggerTarget(triggerOptions);
    } catch (error) {
      console.log(`error: ${error instanceof Error ? error.message : "invalid trigger target"}`);
      return 2;
    }
    if (bindingMode === "unknown" && !ci) console.error("warning: binding mode is unknown; localhost may write remote resources. Use staging for replay/catch-up.");
    if (retries > 0 && !ci) console.error("warning: retries replay the entire expression, including successful siblings; handlers must be idempotent.");
  }

  if (cmd === "ui" && (all || json)) {
    console.log("error: ui is single-app and interactive — --json/--all are not supported");
    return 2;
  }

  let apps: string[];
  try {
    apps = resolveApps(cwd, all, target);
    if (apps.length === 0) throw new Error("no Void apps found");
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
    case "doctor": {
      for (const app of apps) {
        const report = { app: basename(app), ...inspectProject(app, { productionEvidence }) };
        console.log(json ? JSON.stringify(report) : `${report.app}: config ${report.config ?? "missing"} · SDK ${report.sdkVersion ?? "not resolved"} (${report.sdkContract}) · bindings unknown · production trigger ${report.productionTrigger}${report.productionTarget ? ` @ ${report.productionTarget}` : ""} · manifest local-inspection`);
      }
      return 0;
    }
    case "verify": {
      const app = apps[0];
      if (!app || !cronOverride || !evidencePath) {
        console.log("error: verify requires one app path, --cron EXPR, and --evidence FILE");
        return 2;
      }
      try {
        new URL(origin);
      } catch {
        console.log("error: invalid origin");
        return 2;
      }
      const jobs = scanCronFiles(app, { disabled: readDisabled(app) });
      const expressions = new Set(jobs.flatMap((job) => job.expressions));
      if (!expressions.has(cronOverride)) {
        console.log(`error: cron expression "${cronOverride}" is not exported by ${basename(app)}`);
        return 2;
      }
      const res = await triggerExpression(cronOverride, "verification", {
        ...triggerOptions,
        jobs,
        disabled: readDisabled(app),
      });
      const evidence: CronProductionEvidence = {
        format: 1,
        origin: new URL(origin).origin,
        transport: "framework",
        authMode: "framework-internal",
        outcome: res.ok ? "accepted" : (res.httpStatus ?? 0) > 0 ? "rejected" : "unknown",
        httpStatus: res.httpStatus ?? 0,
        verifiedAt: new Date().toISOString(),
        expression: cronOverride,
      };
      try {
        writeProductionEvidence(evidencePath, evidence);
      } catch (error) {
        console.log(`error: ${error instanceof Error ? error.message : "could not write production evidence"}`);
        return 2;
      }
      if (json) console.log(JSON.stringify({ app: basename(app), format: 1, evidence }, null, 2));
      else console.log(`${basename(app)}: production trigger ${evidence.outcome} (HTTP ${evidence.httpStatus}); wrote ${evidencePath}`);
      return res.ok ? 0 : 1;
    }
    case "ui": {
      const app = apps[0];
      if (!app) {
        console.log("error: ui needs one app path");
        return 2;
      }
      return ui({
        ...triggerOptions,
        appPath: app,
        origin,
        ...(tz ? { tz } : {}),
        storeMode,
        ...(token ?? process.env["VOID_DEV_TRIGGER"]
          ? { devToken: token ?? process.env["VOID_DEV_TRIGGER"] }
          : {}),
        retries,
        timeoutMs,
      });
    }
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
            const preview = due !== null ? fmtNext(due, now) : j.status === "active" ? (allPreviewSupported(j.expressions) ? "never" : "preview n/a") : j.status === "disabled" ? "—" : "";
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
        if (limits === "managed" && manifest.expressionCount > MAX_EXPRESSIONS) {
          problems.push(`${manifest.expressionCount}/${MAX_EXPRESSIONS} distinct expressions (managed quota profile)`);
        }
        if (limits === "managed" && manifest.scheduleCount > MAX_SCHEDULES) {
          problems.push(`${manifest.scheduleCount}/${MAX_SCHEDULES} schedules (managed quota profile)`);
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
      let code = 0;
      for (const app of apps) {
        const jobs = scanCronFiles(app, { disabled: readDisabled(app) });
        const byName = jobs.find((j) => j.name === selector || j.path === selector);
        const job = jobs.flatMap((j) => j.expressions.map((e) => ({ job: j, expression: e }))).find(
          (x) => x.expression === selector,
        );
        if (!byName && !job && !isCronExpression(selector)) {
          console.log(`error: no job "${selector}" in ${basename(app)} (${basename(app)} scanned ${jobs.length} jobs) and selector is not a 5-field cron expression\nrun from the app dir, or use trigger <job> --all`);
          code = 1;
          continue;
        }
        const name = byName?.name ?? job?.job.name ?? selector;
        const stub = byName ?? job?.job ?? {
          path: selector,
          name,
          expressions: [selector],
          status: "active",
          usesDefineScheduled: false,
          sharedExpression: false,
        };
        if (cronOverride && (!byName || !byName.expressions.includes(cronOverride))) {
          console.log("error: --cron must select an expression exported by the named job");
          code = 1;
          continue;
        }
        const expressions = byName ? (cronOverride ? [cronOverride] : byName.expressions) : [selector];
        if (!ci) {
          for (const expression of expressions) {
            const affected = jobs.filter((candidate) => candidate.expressions.includes(expression)).map((candidate) => candidate.name);
            if (affected.length > 1) console.error(`warning: expression ${expression} dispatches all matching jobs: ${affected.join(", ")}`);
          }
        }
        const results = await triggerJob({ ...stub, expressions }, { ...triggerOptions, jobs });
        const fired: CronActivityEntry[] = results.flatMap((r) => (r.entry ? [r.entry] : []));
        for (const res of results) {
          if (json) console.log(JSON.stringify({ app: basename(app), format: 1, ...res }));
          else if (res.ok) console.log(`${basename(app)}: dispatch acknowledged ${res.entry?.jobName ?? name} ${res.entry?.cron ?? selector} (${res.entry?.durationMs ?? 0}ms)`);
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
            ...triggerOptions,
            disabled: [...disabled],
            tz,
            timeoutMs,
            maxAttempts: retries + 1,
            store: storeMode,
          });
          if (runOnceResult.fired.some((entry) => entry.status === "failed" || entry.status === "unknown")) code = 1;
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
        await startScheduleLoop(app, { ...triggerOptions, disabled: [...disabled], tz, store: storeMode });
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

// Covers every cron cycle (longest month is 31 days) so monthly forms like
// `0 9 * * 2#2` report a real next fire instead of "never".
const PREVIEW_WINDOW_MS = 40 * 24 * 60 * 60 * 1000;

function nextFire(expressions: string[], nowMs: number, tz?: string): number | null {
  const due = nextDue(expressions, nowMs, nowMs + PREVIEW_WINDOW_MS, { tz })[0];
  return due ? due.dueMs : null;
}

function fmtNext(dueMs: number, nowMs: number): string {
  const s = Math.max(60, Math.round((dueMs - nowMs) / 1000));
  if (s < 120) return "next in <2m";
  if (s < 5400) return `next in ${Math.round(s / 60)}m`;
  if (s >= 36 * 3600) return `next in ${Math.round(s / 86400)}d`;
  return `next in ${Math.round(s / 3600)}h`;
}
