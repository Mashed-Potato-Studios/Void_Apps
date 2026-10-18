import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { canonical } from "./canonical.js";
import { buildManifest, type EmitOptions } from "./manifest.js";
import type { Bindings } from "./scan.js";
import type { FileEntry } from "./scan.js";

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

function readBaselineAtRef(appRoot: string, ref: string): { files?: FileEntry[]; fingerprint?: string } {
  let toplevel: string;
  try {
    toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: appRoot,
      encoding: "utf8",
    }).trim();
    const rel = relative(toplevel, join(realpathSync(appRoot), "void.fingerprint.json")).replace(
      /\\/g,
      "/",
    );
    const out = execFileSync("git", ["show", `${ref}:${rel}`], { cwd: appRoot, encoding: "utf8" });
    return JSON.parse(out) as { files?: FileEntry[]; fingerprint?: string };
  } catch {
    throw new Error(`void-fingerprint: cannot read baseline at ${ref} for ${appRoot}`);
  }
}

const FIELD_SOURCES: Record<string, string> = {
  app: "package.json",
  appType: "package.json",
  adapter: "package.json",
  target: "void.json or void.config.ts",
  voidJson: "void.json or void.config.ts",
  plugins: "vite.config.ts",
  workspaceDeps: "package.json",
  routes: "routes/, pages/, middleware/, crons/, queues/",
  pages: "routes/, pages/, middleware/, crons/, queues/",
  middleware: "routes/, pages/, middleware/, crons/, queues/",
  scanDirs: "fingerprint opts",
  extraPaths: "fingerprint opts",
  drizzle: "drizzle config",
};

function tokenPattern(token: string): RegExp {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (token.startsWith("void/")) return new RegExp(`from\\s+["']${esc}["']|\\b${esc}\\b`);
  return new RegExp(`env\\.${esc}\\b|env\\[["']${esc}["']\\]`);
}

export function locateToken(
  appRoot: string,
  files: FileEntry[],
  token: string,
): string | undefined {
  const re = tokenPattern(token);
  for (const f of files) {
    const lines = readFileSync(join(appRoot, f.path), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && re.test(line)) return `${f.path}:${i + 1}`;
    }
  }
  return undefined;
}

function bindingTokenEntries(
  appRoot: string,
  files: FileEntry[],
  prev: Bindings | undefined,
  next: Bindings,
): ChangedEntry[] {
  const out: ChangedEntry[] = [];
  const before = new Set([...(prev?.specifiers ?? []), ...(prev?.envAccess ?? [])]);
  const after = new Set([...next.specifiers, ...next.envAccess]);
  for (const t of [...after].filter((t) => !before.has(t)).sort()) {
    const evidence = locateToken(appRoot, files, t);
    out.push({ path: `bindings:${t}`, from: null, to: "present", ...(evidence ? { evidence } : {}) });
  }
  for (const t of [...before].filter((t) => !after.has(t)).sort()) {
    out.push({ path: `bindings:${t}`, from: "present", to: null });
  }
  return out;
}

export function diffManifest(appRoot: string, opts: EmitOptions = {}): DiffResult {
  const current = buildManifest(appRoot, opts);
  let disk: Record<string, unknown> & { files?: FileEntry[]; fingerprint?: string; format?: unknown } | null = null;
  if (opts.baseRef) {
    disk = readBaselineAtRef(appRoot, opts.baseRef);
  } else {
    try {
      disk = JSON.parse(readFileSync(join(appRoot, "void.fingerprint.json"), "utf8"));
    } catch {
      disk = null;
    }
  }
  if (disk === null) {
    return {
      clean: false,
      changed: current.files.map((f) => ({ path: f.path, from: null, to: f.sha256 })),
      hash: { committed: null, computed: current.fingerprint },
      isNew: true,
    };
  }
  if (disk.format !== undefined && disk.format !== current.format) {
    throw new Error(
      `void-fingerprint: unsupported manifest format ${String(disk.format)} (expected ${current.format}) — re-run fp:emit`,
    );
  }
  if (!Array.isArray(disk.files)) {
    throw new Error(
      `void-fingerprint: baseline at ${appRoot} is corrupt (missing files[]) — re-run fp:emit`,
    );
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
  const diskRec = disk as unknown as Record<string, unknown>;
  const curRec = current as unknown as Record<string, unknown>;
  for (const [field, source] of Object.entries(FIELD_SOURCES)) {
    if (canonical(diskRec[field] ?? null) !== canonical(curRec[field] ?? null)) {
      changed.push({
        path: field,
        from: canonical(diskRec[field] ?? null).trim(),
        to: canonical(curRec[field] ?? null).trim(),
        evidence: source,
      });
    }
  }
  for (const e of bindingTokenEntries(
    appRoot,
    current.files,
    diskRec["bindings"] as Bindings | undefined,
    current.bindings,
  )) {
    changed.push(e);
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
