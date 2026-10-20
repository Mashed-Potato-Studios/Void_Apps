import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { validateCloudflareCron } from "./cron-expr.js";
import type { CronJob } from "./types.js";
export const CRON_DIR = "crons";
export const CRON_EXTS = [".ts", ".mts", ".js", ".mjs"] as const;

const STRING_EXPORT =
  /export\s+const\s+cron\s*(?::\s*string\s*)?=\s*["']([^"']+)["']/;
const ARRAY_EXPORT =
  /export\s+const\s+cron\s*(?::\s*(?:string\s*\[\]|Array<string>))?\s*=\s*\[([\s\S]*?)\]/;
const QUOTED = /["']([^"']+)["']/g;

/**
 * Synchronous cron check against Cloudflare's Cron Trigger grammar.
 * Accepts Quartz extensions (`L`, `LW`, `15W`, `2#2`, `?`) and DOW names;
 * rejects out-of-range values and non-5-field expressions.
 */
export function isCronExpression(value: string): boolean {
  return validateCloudflareCron(value) === null;
}

/** Strip line/block comments so commented-out exports never scan as real. String-safe. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  let blockDepth = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (blockDepth > 0) {
      if (c === "*" && next === "/") {
        blockDepth--;
        i += 2;
      } else if (c === "/" && next === "*") {
        blockDepth++;
        i += 2;
      } else {
        out += c === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    if (quote !== null) {
      out += c;
      if (c === "\\" && i + 1 < source.length) {
        out += source[i + 1];
        i += 2;
      } else if (c === quote) {
        quote = null;
        i++;
      } else {
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
    } else if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      blockDepth = 1;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
/**
 * `defineScheduled(...)` wrapper detection without the TS compiler (erasable-syntax
 * codebase; `typescript` stays a devDependency). Resolves the `void` import alias
 * (`import { defineScheduled as ds }`) and `void.defineScheduled(...)` namespace
 * calls; ignores bare imports, member access on other objects, method shorthand,
 * and longer identifiers.
 */
function detectsDefineScheduled(source: string): boolean {
  const names = new Set<string>(["defineScheduled"]);
  // import { defineScheduled [as alias] } from 'void' (or "void", any path ending in void)
  const importList = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*void["']/g;
  let m: RegExpExecArray | null;
  while ((m = importList.exec(source)) !== null) {
    for (const part of (m[1] ?? "").split(",")) {
      const alias = /defineScheduled\s+as\s+([\w$]+)/.exec(part);
      if (alias?.[1]) names.add(alias[1]);
    }
  }
  // import * as voidNs from 'void' → voidNs.defineScheduled(...)
  const namespaces = new Set<string>();
  const importNs = /import\s*\*\s*as\s+([\w$]+)\s*from\s*["'][^"']*void["']/g;
  while ((m = importNs.exec(source)) !== null) {
    if (m[1]) namespaces.add(m[1]);
  }
  const hasDirectCall = (name: string): boolean =>
    new RegExp(`(?:^|[^.\\w$])${name}\\s*(?:<[^;(){}]*>\\s*)?\\([^)]`).test(source);
  for (const name of names) {
    if (hasDirectCall(name)) return true;
  }
  for (const ns of namespaces) {
    if (new RegExp(`(?:^|[^\\w$])${ns}\\.defineScheduled\\s*\\([^)]`).test(source)) return true;
  }
  return false;
}

function cronError(expr: string): string {
  return validateCloudflareCron(expr) ?? `invalid cron expression: "${expr}"`;
}

function parseExpressions(source: string): { expressions: string[]; error?: string } {
  const single = source.match(STRING_EXPORT);
  if (single?.[1] !== undefined) {
    const expr = single[1].trim();
    return isCronExpression(expr) ? { expressions: [expr] } : { expressions: [], error: cronError(expr) };
  }
  const multi = source.match(ARRAY_EXPORT);
  if (multi?.[1] !== undefined) {
    const raw = [...multi[1].matchAll(QUOTED)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
    if (raw.length === 0) return { expressions: [], error: "empty cron array: export at least one expression" };
    const bad = raw.find((e) => !isCronExpression(e));
    if (bad !== undefined) return { expressions: [], error: cronError(bad) };
    return { expressions: [...new Set(raw)] };
  }
  if (/export\s+(?:const|let|var)\s+cron\b/.test(source)) {
    return { expressions: [], error: "unsupported cron export: use a string literal or array of string literals" };
  }
  return { expressions: [], error: "missing `export const cron`: void build fails for files in crons/ without a cron export" };
}

function walk(dir: string, root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    // Void ignores files and directories starting with `_`.
    if (e.startsWith("_")) continue;
    const p = join(dir, e);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walk(p, root, out);
    } else if (CRON_EXTS.some((x) => p.endsWith(x))) {
      if (p.endsWith(".d.ts")) continue;
      const rel = relative(root, resolve(p)).replace(/\\/g, "/");
      if (rel.startsWith("..") || rel.includes("../")) continue;
      out.push(p);
    }
  }
  return out;
}

export function scanCronFiles(
  appRoot: string,
  opts: { disabled?: Set<string> | string[] } = {},
): CronJob[] {
  const files = walk(join(appRoot, CRON_DIR), appRoot).sort();
  const disabled = new Set(opts.disabled ?? []);
  const jobs: CronJob[] = files.map((abs) => {
    const rel = relative(appRoot, abs).replace(/\\/g, "/");
    // Void names jobs by their path inside crons/ without the extension
    // (`crons/billing/daily.ts` → `billing/daily`), so nested files never collide.
    const name = rel.replace(new RegExp(`^${CRON_DIR}/`), "").replace(/\.[^./]+$/, "");
    let source = "";
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      return {
        path: rel,
        name,
        expressions: [],
        status: "invalid",
        error: "unreadable file",
        usesDefineScheduled: false,
        sharedExpression: false,
      } satisfies CronJob;
    }
    const stripped = stripComments(source);
    const { expressions, error } = parseExpressions(stripped);
    const usesDefineScheduled = detectsDefineScheduled(stripped);
    if (error !== undefined || expressions.length === 0) {
      return {
        path: rel,
        name,
        expressions: [],
        status: "invalid",
        error,
        usesDefineScheduled,
        sharedExpression: false,
      } satisfies CronJob;
    }
    return {
      path: rel,
      name,
      expressions,
      status: disabled.has(name) || disabled.has(rel) ? "disabled" : "active",
      usesDefineScheduled,
      sharedExpression: false,
    } satisfies CronJob;
  });

  // Jobs sharing one expression each run once per invocation but count
  // once toward the 100-expression platform limit — flag the overlap.
  const counts = new Map<string, number>();
  for (const j of jobs) for (const e of j.expressions) counts.set(e, (counts.get(e) ?? 0) + 1);
  for (const j of jobs) {
    if (j.expressions.some((e) => (counts.get(e) ?? 0) > 1)) j.sharedExpression = true;
  }
  return jobs;
}
