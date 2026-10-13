import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { canonical } from "./canonical.js";
import type { Manifest } from "./manifest.js";

export type Graph = {
  format: 1;
  apps: Record<string, { fingerprint: string; deps: Record<string, string> }>;
  crossApp: string[];
};

function readCommitted(appRoot: string): Manifest {
  const path = join(appRoot, "void.fingerprint.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Manifest;
  } catch {
    throw new Error(
      `void-fingerprint: no committed manifest at ${path}; run fp:emit first`,
    );
  }
}

export function buildGraph(root: string, appDirs: string[]): Graph {
  const apps: Graph["apps"] = {};
  for (const dir of appDirs) {
    const m = readCommitted(dir);
    const name = m.app || relative(root, dir);
    const deps = Object.fromEntries(Object.entries(m.workspaceDeps ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));
    apps[name] = { fingerprint: m.fingerprint, deps };
  }
  const names = new Set(Object.keys(apps));
  const crossApp = Object.entries(apps)
    .filter(([name, a]) => Object.keys(a.deps).some((d) => d !== name && names.has(d)))
    .map(([name]) => name)
    .sort();
  return { format: 1, apps, crossApp };
}

export function writeGraph(root: string, appDirs: string[]): string {
  const path = join(root, "fingerprint.graph.json");
  writeFileSync(path, canonical(buildGraph(root, appDirs)));
  return path;
}
