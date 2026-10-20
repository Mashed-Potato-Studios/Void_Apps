import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { CronExpressionParser } from "cron-parser";
import type { CronJob } from "./types.js";
export const CRON_DIR = "crons";
export const CRON_EXTS = [".ts", ".mts", ".js", ".mjs"] as const;

const STRING_EXPORT =
  /export\s+const\s+cron\s*(?::\s*string\s*)?=\s*["']([^"']+)["']/;
const ARRAY_EXPORT =
  /export\s+const\s+cron\s*(?::\s*(?:string\s*\[\]|Array<string>))?\s*=\s*\[([\s\S]*?)\]/;
const QUOTED = /["']([^"']+)["']/g;

// cron-parser range check: parse() alone only checks tokens;
// next() enforces ranges like 0-59/0-23/1-31/1-12/0-7.
/**
 * Synchronous cron check: shape (5 fields) plus cron-parser range validation.
 * Rejects garbage like `99 99 99 99 99`; accepts DOW names like `MON`.
 */
export function isCronExpression(value: string): boolean {
  const trimmed = value.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return false;
  if (!parts.every((p) => /^[A-Za-z0-9*,\-/]+$/.test(p))) return false;
  try {
    CronExpressionParser.parse(trimmed).next();
    return true;
  } catch {
    return false;
  }
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
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return `unsupported cron expression: "${expr}" (expected 5-field cron)`;
  if (!parts.every((p) => /^[A-Za-z0-9*,\-/]+$/.test(p)))
    return `unsupported cron expression: "${expr}" (expected 5-field cron)`;
  try {
    CronExpressionParser.parse(expr.trim()).next();
    return `unsupported cron expression: "${expr}" (expected 5-field cron)`;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return `invalid cron expression: "${expr}" (${detail})`;
  }
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
  return { expressions: [], error: "missing `export const cron`: Void ignores this file on deploy" };
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
    const name = basename(abs).replace(/\.(m?ts|m?js)$/, "");
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
