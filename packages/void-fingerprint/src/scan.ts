import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { hashFile } from "./canonical.js";

export const SCAN_DIRS = ["routes", "pages", "middleware", "crons", "queues"];
export const FILE_EXTS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

export type FileEntry = { path: string; sha256: string };
export type Bindings = { specifiers: string[]; envAccess: string[] };

function walk(dir: string, root: string, seen: Set<string>, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      let real: string;
      try {
        real = realpathSync(p);
      } catch {
        continue;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      walk(p, root, seen, out);
    } else if (FILE_EXTS.some((x) => p.endsWith(x))) {
      const rel = relative(root, resolve(p)).replace(/\\/g, "/");
      if (rel.startsWith("..") || rel.includes("../")) continue;
      out.push(p);
    }
  }
  return out;
}

export function scanAppFiles(appRoot: string, extraPaths: string[] = []): FileEntry[] {
  const files: FileEntry[] = [];
  for (const d of [...SCAN_DIRS, ...extraPaths]) {
    try {
      for (const f of walk(join(appRoot, d), appRoot, new Set())) {
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
      [...src.matchAll(/from\s+["']void\/([A-Za-z*/-]+)["']/g)]
        .map((m) => (m[1] === undefined ? null : `void/${m[1]}`))
        .filter((x): x is string => x !== null),
    ),
  ].sort();
  const envAccess = [
    ...new Set([
      ...[...src.matchAll(/env\.([A-Z][A-Z0-9_]*)/g)]
        .map((m) => m[1])
        .filter((x): x is string => x !== undefined),
      ...[...src.matchAll(/env\[["']([A-Z][A-Z0-9_]*)["']\]/g)]
        .map((m) => m[1])
        .filter((x): x is string => x !== undefined),
    ]),
  ].sort();
  return { specifiers, envAccess };
}
