import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildManifest, type EmitOptions } from "./manifest.ts";
import type { FileEntry } from "./scan.ts";

export type ChangedEntry = {
  path: string;
  from: string | null;
  to: string | null;
  evidence?: string;
};

export type DiffResult = {
  clean: boolean;
  changed: ChangedEntry[];
  hash: { committed: string | null; computed: string };
  isNew: boolean;
};

export function diffManifest(appRoot: string, opts: EmitOptions = {}): DiffResult {
  const current = buildManifest(appRoot, opts);
  let disk: { files?: FileEntry[]; fingerprint?: string };
  try {
    disk = JSON.parse(readFileSync(join(appRoot, "void.fingerprint.json"), "utf8"));
  } catch {
    return {
      clean: false,
      changed: current.files.map((f) => ({ path: f.path, from: null, to: f.sha256 })),
      hash: { committed: null, computed: current.fingerprint },
      isNew: true,
    };
  }
  const prev = new Map((disk.files ?? []).map((f) => [f.path, f.sha256]));
  const seen = new Set<string>();
  const changed: ChangedEntry[] = [];
  for (const f of current.files) {
    seen.add(f.path);
    const old = prev.get(f.path) ?? null;
    if (old !== f.sha256) {
      changed.push({ path: f.path, from: old, to: f.sha256, evidence: f.path });
    }
  }
  for (const p of prev.keys()) {
    if (!seen.has(p)) changed.push({ path: p, from: prev.get(p) ?? null, to: null, evidence: p });
  }
  changed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const committed = disk.fingerprint ?? null;
  return {
    clean: changed.length === 0 && committed === current.fingerprint,
    changed,
    hash: { committed, computed: current.fingerprint },
    isNew: false,
  };
}
