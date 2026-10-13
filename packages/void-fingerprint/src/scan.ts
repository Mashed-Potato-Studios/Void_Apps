import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { hashFile } from "./canonical.ts";

export const SCAN_DIRS = ["routes", "pages", "middleware", "crons", "queues"];
export const FILE_EXTS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

export type FileEntry = { path: string; sha256: string };
export type Bindings = { specifiers: string[]; envAccess: string[] };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (FILE_EXTS.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

export function scanAppFiles(appRoot: string, extraPaths: string[] = []): FileEntry[] {
  const files: FileEntry[] = [];
  for (const d of [...SCAN_DIRS, ...extraPaths]) {
    try {
      for (const f of walk(join(appRoot, d))) {
        const rel = relative(appRoot, f).replace(/\\/g, "/");
        if (rel.endsWith(".d.ts")) continue;
        files.push({ path: rel, sha256: hashFile(f) });
      }
    } catch {
      // dir absent -> skip (headless apps have no pages/, etc.)
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

export function inferBindings(appRoot: string, files: FileEntry[]): Bindings {
  const src = files.map((f) => readFileSync(join(appRoot, f.path), "utf8")).join("\n");
  const specifiers = [
    ...new Set(
      [...src.matchAll(/from\s+["']void\/([A-Za-z*/-]+)["']/g)].map((m) => `void/${m[1]}`),
    ),
  ].sort();
  const envAccess = [
    ...new Set([
      ...[...src.matchAll(/env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
      ...[...src.matchAll(/env\[["']([A-Z][A-Z0-9_]*)["']\]/g)].map((m) => m[1]),
    ]),
  ].sort();
  return { specifiers, envAccess };
}
