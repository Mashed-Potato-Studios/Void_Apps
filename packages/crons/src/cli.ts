import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { MAX_EXPRESSIONS, MAX_SCHEDULES, buildCronManifest, emitCronManifest, readCronManifest } from "./manifest.js";
import { appendActivityLog, readActivityLog } from "./store.js";
import type { CronActivityEntry } from "./types.js";
import { triggerExpression, triggerJob } from "./trigger.js";
import { scanCronFiles } from "./scan.js";

const USAGE = [
  "usage: void-crons <list|check|emit|trigger> [app-path] [options]",
  "",
  "  list [app-path] [--json] [--all]          scanned jobs + manifest state",
  "  check [app-path] [--all]                  fail (1) on invalid jobs or limit overflow",
  "  emit [app-path]                           write void.crons.json",
  "  trigger <job|expression> [--origin URL] [--cron EXPR] [--token T] [--all]",
  "",
  "  --origin URL   dev server origin (default http://localhost:5173)",
  "  --cron EXPR    expression to fire when triggering by job name",
  "  --token T      x-void-dev-trigger value (else --dev-token is omitted)",
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
  const target = positionals[1];
  const all = flags.has("--all");
  const json = flags.has("--json");
  const ci = flags.has("--ci");

  let apps: string[];
  try {
    apps = resolveApps(cwd, all, cmd === "trigger" ? undefined : target);
  } catch (e) {
    console.log(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  switch (cmd) {
    case "list": {
      let code = 0;
      for (const app of apps) {
        const jobs = scanCronFiles(app, { disabled: readDisabled(app) });
        const manifest = readCronManifest(app);
        if (json) {
          console.log(JSON.stringify({ app: basename(app), jobs, manifest }, null, 2));
        } else {
          console.log(`${basename(app)}: ${jobs.length} job(s)`);
          for (const j of jobs) {
            const expr = j.status === "invalid" ? (j.error ?? "invalid") : j.expressions.join(", ");
            const marker = j.status === "active" ? "●" : j.status === "disabled" ? "○" : "✕";
            console.log(`  ${marker} ${j.name}  ${expr}`);
          }
          if (!manifest && !ci) console.log("  (no void.crons.json — run void-crons emit)");
          if (manifest) {
            const activity = readActivityLog(app, 5);
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
        if (problems.length > 0) {
          code = 1;
          if (json) console.log(JSON.stringify({ app: basename(app), ok: false, problems }, null, 2));
          else {
            console.log(`${basename(app)}: invalid`);
            for (const p of problems) console.log(`  ✕ ${p}`);
          }
        } else if (json) {
          console.log(
            JSON.stringify({
              app: basename(app),
              ok: true,
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
      const selector = target;
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
            });
            if (res.entry) fired.push(res.entry);
            if (json) console.log(JSON.stringify({ app: basename(app), ...res }));
            else if (res.ok) console.log(`${basename(app)}: fired ${byName.name} ${expression} (${res.entry?.durationMs}ms)`);
            else {
              code = 1;
              console.log(`${basename(app)}: failed ${byName.name} ${expression}: ${res.entry?.error ?? res.reason ?? "unknown"} (HTTP ${res.httpStatus ?? 0})`);
            }
          }
          appendActivityLog(app, fired);
          continue;
        }
        // Raw expression: fire it directly (matches Void's dev endpoint semantics).
        const job = jobs.flatMap((j) => j.expressions.map((e) => ({ job: j, expression: e }))).find(
          (x) => x.expression === selector,
        );
        const name = job?.job.name ?? selector;
        const stub = job?.job ?? {
          path: selector,
          name,
          expressions: [selector],
          status: "active",
          usesDefineScheduled: false,
          sharedExpression: false,
        };
        const results = await triggerJob({ ...stub, expressions: [selector] }, { origin, devToken });
        const fired: CronActivityEntry[] = results.flatMap((r) => (r.entry ? [r.entry] : []));
        for (const res of results) {
          if (json) console.log(JSON.stringify({ app: basename(app), ...res }));
          else if (res.ok) console.log(`${basename(app)}: fired ${name} ${selector}`);
          else {
            code = 1;
            console.log(`${basename(app)}: failed ${name} ${selector}: ${res.entry?.error ?? res.reason ?? "unknown"}`);
          }
        }
        appendActivityLog(app, fired);
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
