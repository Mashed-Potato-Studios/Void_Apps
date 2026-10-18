import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkDiffResult } from "./check.js";
import { diffManifest } from "./diff.js";
import { buildGraph, writeGraph, type Graph } from "./graph.js";
import { emitManifest } from "./emit.js";
import { optsForApp } from "./manifest.js";

const USAGE = "usage: void-fingerprint <emit|diff|check|graph> [app-path] [--all] [--json] [--ci] [--base <ref>] [--format mermaid]";

const optsFor = optsForApp;

function isFile(dir: string, name: string): boolean {
  try {
    return statSync(join(dir, name)).isFile();
  } catch {
    return false;
  }
}

function hasVoidConfig(dir: string): boolean {
  return isFile(dir, "void.json") || isFile(dir, "void.config.ts");
}

function resolveApps(cwd: string, all: boolean, positional?: string): string[] {
  if (!all) return [positional ?? cwd];
  const appsDir = cwd.endsWith("/apps") ? cwd : join(cwd, "apps");
  return readdirSync(appsDir)
    .map((d) => join(appsDir, d))
    .filter((p) => {
      try {
        return statSync(p).isDirectory() && hasVoidConfig(p);
      } catch {
        return false;
      }
    })
    .sort();
}

function short(hash: string | null): string {
  return hash === null ? "(new)" : hash.slice(0, 8);
}

function mermaid(graph: Graph): string {
  const id = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, "_");
  const lines = ["graph TD"];
  for (const [app, node] of Object.entries(graph.apps).sort(([a], [b]) => (a < b ? -1 : 1))) {
    lines.push(`  ${id(app)}["${app}"]`);
    for (const dep of Object.keys(node.deps).sort()) {
      lines.push(`  ${id(app)} --> ${id(dep)}["${dep}"]`);
    }
  }
  return lines.join("\n");
}

function humanTable(graph: Graph): string {
  const lines: string[] = [];
  for (const [app, node] of Object.entries(graph.apps).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const deps = Object.entries(node.deps)
      .map(([d, r]) => `${d}@${r}`)
      .join(", ");
    lines.push(`${app}: ${deps || "(no workspace deps)"}`);
  }
  if (graph.crossApp.length > 0) lines.push(`cross-app: ${graph.crossApp.join(", ")}`);
  return lines.join("\n");
}

export async function run(argv: string[], cwd: string): Promise<number> {
  const args = [...argv];
  const flags = new Set<string>();
  const positionals: string[] = [];
  let baseRef: string | undefined;
  let format = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--base") {
      baseRef = args[i + 1];
      i++;
    } else if (a === "--format") {
      format = args[i + 1] ?? "";
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
  const cmd = positionals[0] ?? "check"; // bare invocation = check
  const appPath = positionals[1];
  const all = flags.has("--all");
  const json = flags.has("--json");
  const ci = flags.has("--ci");
  if (args.includes("--base") && !baseRef) {
    console.log(`error: --base needs a git ref\n${USAGE}`);
    return 2;
  }

  let apps: string[];
  try {
    apps = resolveApps(cwd, all, appPath);
  } catch (e) {
    console.log(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  switch (cmd) {
    case "emit": {
      try {
        for (const a of apps) {
          if (!hasVoidConfig(a)) {
            console.log(`error: not a Void app (no void.json or void.config.ts): ${a}`);
            return 2;
          }
          const { path } = emitManifest(a, optsFor(a));
          if (!ci) console.log(`emitted ${path}`);
        }
        return 0;
      } catch (e) {
        console.log(`error: ${e instanceof Error ? e.message : String(e)}`);
        return 2;
      }
    }
    case "diff": {
      let dirty = false;
      let failed = false;
      for (const a of apps) {
        let d;
        try {
          d = diffManifest(a, optsFor(a, baseRef));
        } catch (e) {
          console.log(`error: ${a}: ${e instanceof Error ? e.message : String(e)}`);
          failed = true;
          continue;
        }
        if (d.clean) {
          if (json) console.log(JSON.stringify({ app: a, ok: true, changed: [], hash: d.hash }));
          else console.log(`${a}: clean`);
          continue;
        }
        dirty = true;
        if (json) {
          console.log(JSON.stringify({ app: a, ok: false, changed: d.changed, hash: d.hash }));
        } else {
          console.log(`${a}: drift`);
          for (const c of d.changed) {
            const ev = c.evidence && c.evidence !== c.path ? ` (${c.evidence})` : "";
            console.log(`  ${c.path}: ${short(c.from)} -> ${short(c.to)}${ev}`);
          }
          if (d.changed.length === 0) {
            console.log(
              `  fingerprint: ${short(d.hash.committed)} -> ${short(d.hash.computed)}`,
            );
          }
        }
      }
      if (failed) return 2;
      if (dirty && !json && !ci) console.log("run pnpm fp:emit to regenerate");
      return dirty ? 1 : 0;
    }
    case "check": {
      let code = 0;
      for (const a of apps) {
        let d;
        try {
          d = diffManifest(a, optsFor(a, baseRef));
        } catch (e) {
          console.log(`error: ${a}: ${e instanceof Error ? e.message : String(e)}`);
          code = 2;
          continue;
        }
        if (d.isNew && !baseRef) {
          if (ci) {
            console.log(`${a}: error: no committed manifest (run fp:emit)`);
            code = 2;
          } else {
            console.log(`${a}: warning: not initialized (run pnpm fp:emit)`);
          }
          continue;
        }
        const res = checkDiffResult(d);
        if (!res.clean) {
          code = code === 2 ? 2 : 1;
          console.log(`${a}: drift: ${res.drift.join(", ")}`);
        }
      }
      if (code === 0 && !ci) console.log("clean");
      return code;
    }
    case "graph": {
      try {
        if (!all) {
          const g = buildGraph(cwd, apps);
          console.log(JSON.stringify(g, null, 2));
          return 0;
        }
        const path = writeGraph(cwd, apps);
        console.log(`wrote ${path}`);
        const g = buildGraph(cwd, apps);
        console.log(format === "mermaid" ? mermaid(g) : humanTable(g));
        return 0;
      } catch (e) {
        console.log(`error: ${e instanceof Error ? e.message : String(e)}`);
        return 2;
      }
    }
    default: {
      console.log(USAGE);
      return 2;
    }
  }
}
