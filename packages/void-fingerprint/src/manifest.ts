import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, sha256Hex } from "./canonical.ts";
import { inferBindings, scanAppFiles, type Bindings, type FileEntry, SCAN_DIRS } from "./scan.ts";

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

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parsePlugins(appRoot: string): string[] {
  let src: string;
  try {
    src = readFileSync(join(appRoot, "vite.config.ts"), "utf8");
  } catch {
    return [];
  }
  const arrayBody = src.match(/plugins\s*:\s*\[(.*?)\]/s)?.[1] ?? "";
  return [...arrayBody.matchAll(/(\w+)\(\)/g)].map((m) => m[1]);
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
  const voidJson = readJson(join(appRoot, "void.json")) as { target?: string };
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
