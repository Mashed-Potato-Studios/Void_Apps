import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createStyle, GLYPH } from "./cli-style.js";
import { COMMANDS, renderHelp } from "./cli-help.js";
import { MAX_EXPRESSIONS, MAX_SCHEDULES, buildCronManifest, detectDrift, emitCronManifest, readCronManifest } from "./manifest.js";
import { appendActivityLog, readActivityLog, type ActivityStoreMode } from "./store.js";
import type { CronActivityEntry, CronTriggerOptions } from "./types.js";
import { nextDue, nextFires, isValidTimezone, runScheduleOnce, startScheduleLoop } from "./schedule.js";
import { resolveTriggerTarget, triggerExpression, triggerJob } from "./trigger.js";
import { findVoidConfig, inspectProject } from "./project.js";
import { readProductionEvidence, writeProductionEvidence } from "./production.js";
import type { CronProductionEvidence } from "./evidence.js";
import { isCronExpression, scanCronFiles } from "./scan.js";
import { allPreviewSupported, isPreviewSupported, validateCloudflareCron } from "./cron-expr.js";
import { queueCounts, scanQueueFiles, validateQueueName } from "./queue-scan.js";
import { sendQueueBatch, type QueueSendMessage } from "./queue-send.js";
import { startTui, type TuiOptions } from "./tui/run.js";

const HELP_HINT = "Run void-crons --help for usage.";
const COMMAND_NAMES = new Set(COMMANDS.map((command) => command.name));

function getVersion(): string {
  try {
    const manifest = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const version = (JSON.parse(manifest) as { version?: string }).version;
    return typeof version === "string" ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
const VERSION = getVersion();

/** First-run guidance for an app with no cron jobs yet. */
function renderOnboarding(style: ReturnType<typeof createStyle>): string[] {
  const sample = [
    'import { defineScheduled } from "void";',
    'export const cron = "* * * * *";',
    "export default defineScheduled(async () => {});",
  ];
  return [
    `  ${style.bold("No cron jobs yet")} — here's how to start:`,
    "",
    `  ${style.dim("Add a file to")} crons/heartbeat.ts ${style.dim("to get started:")}`,
    ...sample.map((line) => `    ${style.cyan(line)}`),
    "",
    `  ${style.dim("Then:")} void-crons list · void-crons check · void-crons emit`,
    `  ${style.dim("Guide:")} https://void.cloud/guide/jobs`,
  ];
}

/** Read an option's value, refusing a missing value or the next flag swallowing it. */
function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requireInt(args: string[], index: number, flag: string, min: number): number {
  const raw = requireValue(args, index, flag);
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} expects a non-negative integer`);
  return Math.max(min, Number.parseInt(raw, 10));
}

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
  let colorOverride: boolean | undefined;
  let count: number | undefined;
  let bodyText: string | undefined;
  try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === undefined) continue;
      if (a === "--origin") {
        origin = requireValue(args, i, a);
        i++;
      } else if (a === "--cron") {
        cronOverride = requireValue(args, i, a);
        i++;
      } else if (a === "--token") {
        token = requireValue(args, i, a);
        i++;
      } else if (a === "--tz") {
        tz = requireValue(args, i, a);
        i++;
      } else if (a === "--retries") {
        retries = requireInt(args, i, a, 0);
        i++;
      } else if (a === "--timeout") {
        timeoutMs = requireInt(args, i, a, 1);
        i++;
      } else if (a === "--count") {
        count = requireInt(args, i, a, 1);
        i++;
      } else if (a === "--body") {
        bodyText = requireValue(args, i, a);
        i++;
      } else if (a === "--transport") {
        transport = requireValue(args, i, a);
        i++;
      } else if (a === "--binding-mode") {
        bindingMode = requireValue(args, i, a);
        i++;
      } else if (a === "--limits") {
        limits = requireValue(args, i, a);
        i++;
      } else if (a === "--store") {
        store = requireValue(args, i, a);
        i++;
      } else if (a === "--evidence") {
        evidencePath = requireValue(args, i, a);
        i++;
      } else if (a === "--color") {
        colorOverride = true;
      } else if (a === "--no-color") {
        colorOverride = false;
      } else if (a === "-v" || a === "-h") {
        flags.add(a);
      } else if (a.startsWith("--")) {
        flags.add(a);
      } else {
        positionals.push(a);
      }
    }
  } catch (error) {
    console.log(`error: ${error instanceof Error ? error.message : String(error)}\n${HELP_HINT}`);
    return 2;
  }
  const style = createStyle(colorOverride === undefined ? {} : { color: colorOverride });
  if (flags.has("--version") || flags.has("-v")) {
    console.log(`void-crons ${VERSION}`);
    return 0;
  }
  const explicitCmd = positionals[0];
  const cmd = explicitCmd ?? "list";
  if (flags.has("--help") || flags.has("-h") || cmd === "help") {
    const topic =
      cmd === "help" ? positionals[1] : explicitCmd && COMMAND_NAMES.has(explicitCmd) ? explicitCmd : undefined;
    console.log(renderHelp(topic, style));
    return topic !== undefined && !COMMAND_NAMES.has(topic) ? 2 : 0;
  }
  // `trigger` and `next` take the selector first, then an optional app path:
  // `<command> <job|expr> [app-path]`. Other commands take `[app-path]` first.
  const selectorFirst = cmd === "trigger" || cmd === "next" || cmd === "queue-send";
  const target = selectorFirst ? positionals[2] : positionals[1];
  const selector = selectorFirst ? positionals[1] : undefined;
  const triggerSelector = cmd === "trigger" ? selector : undefined;
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
  if (cmd === "next" && all) {
    console.log("error: next is single-app — pass one app path");
    return 2;
  }
  if (cmd === "queue-send" && all) {
    console.log("error: queue-send is single-app — pass one app path");
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
        if (json) {
          console.log(JSON.stringify(report));
          continue;
        }
        const trigger =
          report.productionTrigger === "verified"
            ? style.green(report.productionTrigger)
            : report.productionTrigger === "rejected"
              ? style.red(report.productionTrigger)
              : style.yellow(report.productionTrigger);
        console.log(`${style.bold(report.app)}: config ${report.config ?? style.yellow("missing")} · SDK ${report.sdkVersion ?? style.yellow("not resolved")} (${report.sdkContract}) · bindings unknown · production trigger ${trigger}${report.productionTarget ? ` @ ${report.productionTarget}` : ""} · manifest local-inspection`);
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
          const appName = basename(app);
          console.log(`${style.bold(appName)}: ${jobs.length} job(s)${tz ? ` (tz ${tz})` : ""}`);
          if (jobs.length === 0 && !ci) {
            for (const line of renderOnboarding(style)) console.log(line);
          }
          for (const j of jobs) {
            const expr = j.status === "invalid" ? (j.error ?? "invalid") : j.expressions.join(", ");
            const marker =
              j.status === "active"
                ? style.green(GLYPH.active)
                : j.status === "disabled"
                  ? style.yellow(GLYPH.disabled)
                  : style.red(GLYPH.invalid);
            const due = j.status === "active" ? nextFire(j.expressions, now, tz) : null;
            const preview = due !== null ? fmtNext(due, now) : j.status === "active" ? (allPreviewSupported(j.expressions) ? "never" : "preview n/a") : j.status === "disabled" ? "—" : "";
            console.log(`  ${marker} ${j.name}  ${expr}${preview ? `  ${preview}` : ""}`);
          }
          if (!manifest && !ci && jobs.length > 0) {
            console.log(`  ${style.dim("(no void.crons.json — run void-crons emit)")}`);
          }
          if (manifest) {
            const activity = readActivityLog(app, 5, storeMode);
            for (const entry of activity) {
              const status = entry.status === "success" ? style.green(entry.status) : style.red(entry.status);
              console.log(`  ${style.dim(GLYPH.arrow)} ${entry.jobName} ${entry.cron} ${status} ${(entry.durationMs / 1000).toFixed(1)}s`);
            }
          }
        }
        if (jobs.some((j) => j.status === "invalid")) code = 1;
      }
      return code;
    }
    case "next": {
      if (!selector) {
        console.log(`error: next needs a cron expression or job name\n${HELP_HINT}\n${renderHelp("next", style)}`);
        return 2;
      }
      const nextCount = Math.min(50, count ?? 5);
      const now = Date.now();
      let expressions: string[];
      if (isCronExpression(selector)) {
        const problem = validateCloudflareCron(selector);
        if (problem !== null) {
          console.log(`error: ${problem}`);
          return 2;
        }
        if (!isPreviewSupported(selector)) {
          console.log(`error: cron expression "${selector}" cannot be previewed locally`);
          return 2;
        }
        expressions = [selector];
      } else {
        const app = apps[0];
        if (!app) {
          console.log("error: next needs one app path");
          return 2;
        }
        const jobs = scanCronFiles(app, { disabled: readDisabled(app) });
        const job = jobs.find((j) => j.name === selector || j.path === selector);
        if (!job) {
          console.log(`error: no job "${selector}" in ${basename(app)} (${basename(app)} scanned ${jobs.length} jobs) and selector is not a 5-field cron expression`);
          return 1;
        }
        if (job.status !== "active") {
          console.log(`error: job "${selector}" is ${job.status} — no next fire to preview`);
          return 1;
        }
        expressions = job.expressions;
      }
      const zones = { tz };
      const results = expressions.map((expression) => ({
        expression,
        fires: nextFires(expression, nextCount, { ...zones, fromMs: now }).map((ms) => new Date(ms).toISOString()),
      }));
      if (json) {
        console.log(JSON.stringify({ format: 1, selector, tz: tz ?? "UTC", results }, null, 2));
      } else {
        console.log(`${selector} · next ${nextCount} fire(s) (${tz ?? "UTC"})`);
        for (const { expression, fires } of results) {
          if (expressions.length > 1) console.log(`  ${expression}`);
          if (fires.length === 0) console.log(`    ${style.yellow("never — no due time found in the preview horizon")}`);
          else for (const fire of fires) console.log(`    ${fire}`);
        }
      }
      return 0;
    }
    case "queues": {
      let code = 0;
      for (const app of apps) {
        const queues = scanQueueFiles(app);
        const counts = queueCounts(queues);
        if (json) {
          console.log(JSON.stringify({ app: basename(app), format: 1, ok: counts.invalid === 0, counts, queues }, null, 2));
        } else if (!ci || counts.invalid > 0) {
          console.log(`${style.bold(basename(app))}: ${counts.queues} queue(s), ${counts.active} active`);
          for (const queue of queues) {
            const marker = queue.status === "active" ? style.green(GLYPH.active) : style.red(GLYPH.invalid);
            const optionText = Object.entries(queue.options).map(([key, value]) => `${key}=${value}`).join(" ");
            const error = queue.error ? `  ${style.red(queue.error)}` : "";
            console.log(`  ${marker} ${queue.name}  ${queue.path}${optionText ? `  ${style.dim(optionText)}` : ""}${error}`);
          }
        }
        if (counts.invalid > 0) code = 1;
      }
      return code;
    }
    case "queue-send": {
      if (!selector) {
        console.log(`error: queue-send needs a queue name\n${HELP_HINT}\n${renderHelp("queue-send", style)}`);
        return 2;
      }
      const problem = validateQueueName(selector);
      if (problem !== null) {
        console.log(`error: ${problem}`);
        return 2;
      }
      let body: unknown = {};
      if (bodyText !== undefined) {
        try {
          body = JSON.parse(bodyText) as unknown;
        } catch {
          console.log("error: --body must be valid JSON");
          return 2;
        }
      }
      const app = apps[0] ?? cwd;
      const known = scanQueueFiles(app);
      const match = known.find((queue) => queue.name === selector);
      if (match?.status === "invalid") {
        console.log(`error: queue "${selector}" is invalid: ${match.error}`);
        return 1;
      }
      if (known.length > 0 && !match && !ci) {
        console.error(`warning: queue "${selector}" not found in ${basename(app)}; dispatching by name anyway`);
      }
      const messages: QueueSendMessage[] = Array.from({ length: Math.min(100, count ?? 1) }, () => ({ body }));
      const res = await sendQueueBatch(selector, messages, {
        origin,
        devToken: token ?? process.env["VOID_DEV_TRIGGER"],
        timeoutMs,
        maxAttempts: retries + 1,
      });
      const label = basename(app);
      if (json) console.log(JSON.stringify({ format: 1, app: label, queue: selector, ...res }, null, 2));
      else if (!ci) {
        if (res.ok) console.log(`${label}: dispatched ${selector} (${res.count} message(s), ${res.durationMs}ms, attempts ${res.attempts})`);
        else console.log(`${label}: failed ${selector}: ${res.reason ?? "unknown"} (HTTP ${res.httpStatus}, attempts ${res.attempts})`);
      }
      return res.ok ? 0 : 1;
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
            console.log(`${style.red(`${GLYPH.fail} ${basename(app)}: invalid`)}`);
            for (const p of problems) console.log(`  ${style.red(GLYPH.fail)} ${p}`);
          }
          if (drift.length > 0 && !json && !ci) console.log(`  ${style.dim("run void-crons emit to regenerate")}`);
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
            `${style.green(GLYPH.ok)} ${basename(app)}: clean (${manifest.jobs.length} jobs, ${manifest.expressionCount} expr, ${manifest.scheduleCount} sched)`,
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
        console.log(`error: trigger needs a job name or cron expression\n${HELP_HINT}\n${renderHelp("trigger", style)}`);
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
        console.log(`error: live schedule runs one app at a time — pass an app path (batch catch-up: schedule --all --once)\n${HELP_HINT}`);
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
      console.log(`error: unknown command "${cmd}"\n${renderHelp(undefined, style)}`);
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
