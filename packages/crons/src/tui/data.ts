import { basename } from "node:path";
import { detectDrift, readCronManifest } from "../manifest.js";
import { scanCronFiles } from "../scan.js";
import { computeDue } from "../schedule.js";
import { readActivityLog, type ActivityStoreMode } from "../store.js";
import type { CronActivityEntry, CronJob } from "../types.js";
import type { JobView, ManifestState, Snapshot } from "./model.js";

const PREVIEW_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

export interface SnapshotOptions {
  disabled?: string[];
  tz?: string;
  storeMode?: ActivityStoreMode;
  activityLimit?: number;
  nowMs?: number;
}

function nextFire(job: CronJob, nowMs: number, tz?: string): number | null {
  const due = computeDue(job.expressions, nowMs + 1, nowMs + PREVIEW_WINDOW_MS, tz ? { tz } : {})[0];
  return due ? due.dueMs : null;
}

export function loadSnapshot(appPath: string, opts: SnapshotOptions = {}): Snapshot {
  const nowMs = opts.nowMs ?? Date.now();
  const storeMode = opts.storeMode ?? "sqlite";
  const stored = readCronManifest(appPath);
  const disabled = opts.disabled ?? stored?.disabled ?? [];
  const jobs = scanCronFiles(appPath, { disabled });
  const activity = readActivityLog(appPath, opts.activityLimit ?? 10, storeMode);
  const lastByJob = new Map<string, CronActivityEntry>();
  for (const entry of activity) {
    if (!lastByJob.has(entry.jobName)) lastByJob.set(entry.jobName, entry);
  }
  const views: JobView[] = jobs.map((job) => {
    const last = lastByJob.get(job.name);
    return {
      ...job,
      nextFireMs: job.status === "active" ? nextFire(job, nowMs, opts.tz) : null,
      ...(last ? { last } : {}),
    };
  });
  let manifest: ManifestState = "missing";
  let drift: string[] = [];
  if (stored) {
    drift = detectDrift(stored, scanCronFiles(appPath, { disabled }), { disabled });
    manifest = drift.length > 0 ? "drift" : "clean";
  }
  return {
    appName: basename(appPath),
    jobs: views,
    manifest,
    drift,
    activity,
    disabled: [...disabled].sort(),
    scannedAt: nowMs,
  };
}
