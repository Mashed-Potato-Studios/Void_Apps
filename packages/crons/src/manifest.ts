import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { scanCronFiles } from "./scan.js";
import type { CronJob, CronManifest } from "./types.js";

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

export const CRON_MANIFEST_FILE = "void.crons.json";
/** Void platform caps: 100 distinct expressions, 1000 schedules per project. */
export const MAX_EXPRESSIONS = 100;
export const MAX_SCHEDULES = 1000;

export function readManifestDisabled(appRoot: string): string[] {
  try {
    const raw = readFileSync(join(appRoot, CRON_MANIFEST_FILE), "utf8");
    const parsed = JSON.parse(raw) as { disabled?: unknown };
    if (!Array.isArray(parsed.disabled)) return [];
    return parsed.disabled.filter((d): d is string => typeof d === "string");
  } catch {
    return [];
  }
}

export function buildCronManifest(
  appRoot: string,
  opts: { disabled?: string[] } = {},
): CronManifest {
  const disabled = opts.disabled ?? readManifestDisabled(appRoot);
  const jobs = scanCronFiles(appRoot, { disabled });
  const deployable = jobs.filter((j) => j.status === "active");
  const expressions = [...new Set(deployable.flatMap((j) => j.expressions))].sort();
  const scheduleCount = deployable.reduce((n, j) => n + j.expressions.length, 0);
  return {
    format: 1,
    app: basename(appRoot),
    emittedAt: new Date().toISOString(),
    jobs,
    expressionCount: expressions.length,
    scheduleCount,
    disabled: jobs.filter((j) => j.status === "disabled").map((j) => j.name),
    invalid: jobs
      .filter((j) => j.status === "invalid")
      .map((j) => ({ path: j.path, error: j.error ?? "invalid job file" })),
  };
}

export function emitCronManifest(
  appRoot: string,
  opts: { disabled?: string[] } = {},
): { manifest: CronManifest; path: string } {
  const manifest = buildCronManifest(appRoot, opts);
  const path = join(appRoot, CRON_MANIFEST_FILE);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, path };
}

export function readCronManifest(appRoot: string): CronManifest | null {
  try {
    return JSON.parse(readFileSync(join(appRoot, CRON_MANIFEST_FILE), "utf8")) as CronManifest;
  } catch {
    return null;
  }
}
