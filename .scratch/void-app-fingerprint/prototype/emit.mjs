// THROWAWAY prototype for wayfinder ticket #7 — NOT packaged, NOT shipped.
// Probe: hand-rolled fingerprint emitter against apps/api. Keeping it is a new request.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const appRoot = new URL("../../../apps/api/", import.meta.url).pathname.replace(/\/$/, "");
const SCAN_DIRS = ["routes", "pages", "middleware", "crons", "queues"];
const EXTRA_PATHS = ["workflows"]; // default-off field, enabled here to probe outlier
const EXT = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

const sha = (s) => createHash("sha256").update(s).digest("hex");
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : (v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const canonical = (v) => JSON.stringify(sortKeys(v)) + "\n";

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

const files = [];
for (const d of [...SCAN_DIRS, ...EXTRA_PATHS]) {
  try {
    for (const f of walk(join(appRoot, d))) {
      const rel = relative(appRoot, f);
      files.push({ path: rel, sha256: sha(readFileSync(f)).slice(0, 16) });
    }
  } catch { /* dir absent -> skip */ }
}
files.sort((a, b) => a.path.localeCompare(b.path));

const src = files.map((f) => readFileSync(join(appRoot, f.path), "utf8")).join("\n");
const bindings = {
  specifiers: [...new Set([...src.matchAll(/from\s+["']void\/([a-z*/-]+)["']/g)].map((m) => `void/${m[1]}`))],
  envAccess: [...new Set([...src.matchAll(/env\.(DB|KV|STORAGE|AI|QUEUE_[A-Z_]+)/g)].map((m) => m[1]))],
};

const manifest = {
  format: 1,
  app: "@void-monorepo/api",
  target: JSON.parse(readFileSync(join(appRoot, "void.json"), "utf8")).target,
  scanDirs: SCAN_DIRS,
  extraPaths: EXTRA_PATHS,
  files,
  bindings,
  voidJson: JSON.parse(readFileSync(join(appRoot, "void.json"), "utf8")),
  workspaceDeps: Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")).dependencies ?? {})),
};
manifest.fingerprint = sha(canonical({ ...manifest }));
console.log(canonical(manifest));
