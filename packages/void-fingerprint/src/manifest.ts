import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, sha256Hex } from "./canonical.js";
import { inferBindings, scanAppFiles, type Bindings, type FileEntry, SCAN_DIRS } from "./scan.js";

export type Manifest = {
  format: 1;
  app: string;
  appType: string;
  adapter: string | null;
  target: string;
  routes: string[];
  pages: string[];
  middleware: string[];
  scanDirs: string[];
  extraPaths: string[];
  files: FileEntry[];
  bindings: Bindings;
  voidJson: unknown;
  plugins: string[];
  drizzle: { schemaHash: string; migrationHashes: string[] } | null;
  workspaceDeps: Record<string, string>;
  fingerprint: string;
};

export type EmitOptions = { extraPaths?: string[]; baseRef?: string };

// Never put secrets in void.json: the full snapshot is committed verbatim
// into void.fingerprint.json and printed by `diff --json`.
export const EXTRA_BY_APP: Record<string, string[]> = {
  "@void-monorepo/api": ["workflows"],
};

function readPkgName(appRoot: string): string {
  try {
    return (JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { name: string })
      .name;
  } catch {
    return "";
  }
}

/** Shared mapping used by both the CLI and the Vite plugin so snapshots agree. */
export function optsForApp(appRoot: string, baseRef?: string): EmitOptions {
  return {
    extraPaths: EXTRA_BY_APP[readPkgName(appRoot)] ?? [],
    ...(baseRef ? { baseRef } : {}),
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readVoidConfig(appRoot: string): { target?: string } {
  let raw: string | null = null;
  try {
    raw = readFileSync(join(appRoot, "void.json"), "utf8");
  } catch {
    raw = null;
  }
  if (raw !== null) {
    // Present but unparseable void.json is a tool error, not a silent fallback.
    return JSON.parse(raw) as { target?: string };
  }
  // void.config.ts apps (real void@1.x SDK): extract the inline target string.
  try {
    const src = readFileSync(join(appRoot, "void.config.ts"), "utf8");
    const target = src.match(/target\s*:\s*["']([^"']+)["']/)?.[1];
    return target ? { target } : {};
  } catch {
    return {};
  }
}

function parsePlugins(appRoot: string): string[] {
  let src: string;
  try {
    src = readFileSync(join(appRoot, "vite.config.ts"), "utf8");
  } catch {
    return [];
  }
  const arrayBody = src.match(/plugins\s*:\s*\[(.*?)\]/s)?.[1] ?? "";
  return [...arrayBody.matchAll(/(\w+)\s*\(/g)]
    .map((m) => m[1])
    .filter((x): x is string => x !== undefined);
}

export function manifestFingerprint(m: Omit<Manifest, "fingerprint">): string {
  return sha256Hex(canonical(m));
}

export function buildManifest(appRoot: string, opts: EmitOptions = {}): Manifest {
  const extraPaths = opts.extraPaths ?? [];
  const pkg = readJson(join(appRoot, "package.json")) as {
    name: string;
    dependencies?: Record<string, string>;
  };
  const voidJson = readVoidConfig(appRoot);
  const files = scanAppFiles(appRoot, extraPaths);
  const by = (prefix: string): string[] =>
    files.map((f) => f.path).filter((p) => p.startsWith(prefix));
  const body = {
    format: 1 as const,
    app: pkg.name,
    appType: "standard",
    adapter: null,
    target: voidJson.target ?? "unknown",
    routes: by("routes/"),
    pages: by("pages/"),
    middleware: by("middleware/"),
    scanDirs: SCAN_DIRS,
    extraPaths,
    files,
    bindings: inferBindings(appRoot, files),
    voidJson,
    plugins: parsePlugins(appRoot),
    drizzle: null,
    workspaceDeps: pkg.dependencies ?? {},
  };
  return { ...body, fingerprint: manifestFingerprint(body) };
}
