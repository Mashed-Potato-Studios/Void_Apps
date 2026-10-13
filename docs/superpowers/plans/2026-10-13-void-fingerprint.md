# void-fingerprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and dogfood the `void-fingerprint` OSS package: manifest + SHA-256 + `emit/diff/check/graph` CLI + thin Vite plugin + Turbo/CI wiring.

**Architecture:** Pure-TS core lib with zero runtime deps (canonical JSON, file scanner mirroring Void resolution order, manifest builder, diff/check/graph), a dependency-free arg-parsing bin, and a thin Vite wrapper that only calls the lib. Tests run on `node --test` with Node 22 type-stripping, no test framework to install.

**Tech Stack:** TypeScript (erasable syntax only), Node 22 (`node:test`, `node:fs`, `node:crypto`, `node:path`), tsc build to `dist/`, Turbo + pnpm workspaces, GitHub Actions.

**Spec:** `docs/superpowers/specs/void-fingerprint.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- `node >= 22` everywhere (type-stripping runs TS sources and the TS bin with no loader).
- Erasable TypeScript only: `type`/`interface`/annotations allowed; no `enum`, `namespace`, or parameter properties.
- Zero runtime dependencies in `packages/fingerprint` (only `devDependencies`: `typescript`, `@void-monorepo/config`).
- Public name `void-fingerprint`, MIT, version `0.1.0`; internal consumers link via `workspace:*`.
- Hash: SHA-256 over canonical JSON (recursively sorted keys, `JSON.stringify` + trailing LF), `format: 1`.
- Baseline for `diff`/`check` is the committed `void.fingerprint.json`, never the build output.
- Commits: one per task, conventional prefix (`feat:`, `chore:`, `ci:`).

## Review Focus

- Windows-style CRLF checked into a route file changes its sha even though content is identical — plan pins LF normalization in the scanner task test.
- A route file importing `void/db` via `env["DB"]` (bracket-string) instead of `env.DB` is missed by the naive regex — plan pins both forms in the bindings test.
- `apps/api/workflows/` must be excluded by default and included only via `extraPaths` — plan pins both cases in the scan task test.
- `diff` on a first-run app with no committed manifest must report the whole manifest as new, not crash — plan pins this in the diff task test.
- `check --ci` must exit 1 on drift and 0 on clean with no stack trace in either case — plan pins exit codes in the CLI task test.

---

## File Structure

New package `packages/fingerprint/` (one clear responsibility per file):

- `package.json` — public metadata, `bin`, `exports` → `dist`, `files`, scripts (`build`, `typecheck`, `test`).
- `tsconfig.json` — extends `@void-monorepo/config/tsconfig/package.json`, `include: ["src/**/*", "test/**/*"]`.
- `LICENSE` — MIT text.
- `src/canonical.ts` — `sortKeys`, `canonical`, `sha256Hex`, `hashFile`. No imports except `node:crypto`, `node:fs`.
- `src/scan.ts` — `SCAN_DIRS`, `FILE_EXTS`, `scanAppFiles(appRoot, extraPaths)`, `inferBindings(appRoot, files)`. Imports `node:fs`, `node:path`.
- `src/manifest.ts` — `Manifest`/`FileEntry`/`Bindings` types, `buildManifest(appRoot, opts)`, `manifestFingerprint`. Imports `./canonical.js`, `./scan.js`, `node:fs`, `node:path`.
- `src/emit.ts` — `emitManifest(appRoot, opts)` writes `void.fingerprint.json`. Imports `./manifest.js`.
- `src/diff.ts` — `diffManifest(appRoot, opts)` compares working tree vs committed file. Imports `./manifest.js`.
- `src/check.ts` — `checkFingerprint(appRoot, opts)` returns `{clean, drift}`. Imports `./diff.js`.
- `src/graph.ts` — `buildGraph(root, apps)`, `writeGraph`. Imports `./manifest.js` (read-only), `node:fs`, `node:path`.
- `src/cli.ts` — `run(argv, cwd)` implementing `emit|diff|check|graph`, `--all`, `--json`, exit codes. Imports all above.
- `bin/void-fingerprint.mjs` — `#!/usr/bin/env node` + `import { run } from "../dist/cli.js"` + `process.exitCode`.
- `src/plugin.ts` — `fingerprintPlugin(opts)` thin Vite wrapper. Peer-optional `vite` import via `import type`.
- `src/index.ts` — re-exports lib (`canonical`, `scan`, `manifest`, `emit`, `diff`, `check`, `graph`, `plugin`).
- `test/fixtures/demo-app/` — fixture app (`void.json`, `package.json`, `routes/hello.ts`, `middleware/auth.ts`, `workflows/extra.ts`).
- `test/*.test.ts` — one per task, `node:test` + `node:assert/strict`.

Modified outside the package:

- `turbo.json` — add `test` and `fingerprint:check` tasks.
- `apps/*/package.json` — add `fingerprint:check` script (bin via workspace dep) + `void-fingerprint` devDependency.
- `.github/workflows/deploy.yml` — `validate` job gains fingerprint check step after typecheck.
- `apps/*/void.fingerprint.json` + `fingerprint.graph.json` — committed dogfood artifacts (Task 8).
- Root `package.json` — `references` gains `./packages/fingerprint`; root `test` script.

---

### Task 1: Scaffold the package

**Files:**
- Create: `packages/fingerprint/package.json`
- Create: `packages/fingerprint/tsconfig.json`
- Create: `packages/fingerprint/LICENSE`
- Create: `packages/fingerprint/src/index.ts`
- Modify: root `tsconfig.json` (`references` += `{ "path": "./packages/fingerprint" }`)

**Interfaces:**
- Consumes: `@void-monorepo/config/tsconfig/package.json` (existing base config).
- Produces: importable package path `@void-monorepo/fingerprint` → replaced by public name in Task 7 wiring; `src/index.ts` placeholder export `FORMAT = 1 as const` that Task 2–6 extend (never removed).

- [ ] **Step 1: Write package.json**

```json
{
  "name": "void-fingerprint",
  "version": "0.1.0",
  "private": false,
  "description": "Stable app fingerprint (manifest + hash + CLI) for Void Cloud apps",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=22" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./package.json": "./package.json"
  },
  "bin": { "void-fingerprint": "./bin/void-fingerprint.mjs" },
  "files": ["dist", "bin"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "node --test \"test/**/*.test.ts\"",
    "prepublishOnly": "pnpm run build"
  },
  "devDependencies": {
    "@void-monorepo/config": "workspace:*",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "extends": "@void-monorepo/config/tsconfig/package.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Write src/index.ts seed**

```ts
export const FORMAT = 1 as const;
```

- [ ] **Step 4: Write LICENSE (MIT, author titan-65)**

```
MIT License

Copyright (c) 2026 titan-65

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: Add tsconfig reference**

Run: `pnpm install` then `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (new empty project typechecks; `references` includes `./packages/fingerprint`).

- [ ] **Step 6: Commit**

```bash
git add packages/fingerprint docs/superpowers/specs/void-fingerprint.md tsconfig.json
git commit -m "feat: scaffold void-fingerprint package (spec included)"
```

---

### Task 2: Canonical JSON + hashing

**Files:**
- Create: `packages/fingerprint/src/canonical.ts`
- Create: `packages/fingerprint/test/canonical.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `sortKeys(value: unknown): unknown`, `canonical(value: unknown): string`, `sha256Hex(s: string): string`, `hashFile(path: string): string` (LF-normalized, full 64-char hex). Later tasks import these exact names from `../src/canonical.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, hashFile, sha256Hex } from "../src/canonical.ts";

describe("canonical", () => {
  it("sorts keys recursively with trailing LF", () => {
    assert.equal(canonical({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}\n');
  });
  it("sha256Hex is 64 hex chars", () => {
    assert.match(sha256Hex("x"), /^[0-9a-f]{64}$/);
  });
  it("hashFile normalizes CRLF to LF", () => {
    const dir = mkdtempSync(join(tmpdir(), "fp-"));
    const a = join(dir, "a.ts");
    const b = join(dir, "b.ts");
    writeFileSync(a, "line1\r\nline2\r\n");
    writeFileSync(b, "line1\nline2\n");
    assert.equal(hashFile(a), hashFile(b));
    assert.match(hashFile(a), /^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/fingerprint/test/canonical.test.ts`
Expected: FAIL with "Cannot find module '../src/canonical.ts'".

- [ ] **Step 3: Write minimal implementation**

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value)) + "\n";
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function hashFile(path: string): string {
  const raw = readFileSync(path, "utf8");
  return sha256Hex(raw.replace(/\r\n/g, "\n"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/fingerprint/test/canonical.test.ts`
Expected: PASS (3 subtests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter void-fingerprint typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fingerprint/src/canonical.ts packages/fingerprint/test/canonical.test.ts
git commit -m "feat: add canonical JSON and LF-normalized file hashing"
```

---

### Task 3: App scanner (files + bindings)

**Files:**
- Create: `packages/fingerprint/src/scan.ts`
- Create: `packages/fingerprint/test/fixtures/demo-app/void.json`
- Create: `packages/fingerprint/test/fixtures/demo-app/package.json`
- Create: `packages/fingerprint/test/fixtures/demo-app/routes/hello.ts`
- Create: `packages/fingerprint/test/fixtures/demo-app/middleware/auth.ts`
- Create: `packages/fingerprint/test/fixtures/demo-app/workflows/extra.ts`
- Create: `packages/fingerprint/test/scan.test.ts`

**Interfaces:**
- Consumes: `hashFile` from `../src/canonical.ts`.
- Produces: `SCAN_DIRS: string[]` (`["routes","pages","middleware","crons","queues"]`), `FILE_EXTS: string[]` (`[".ts",".tsx",".mts",".js",".jsx",".mjs"]`), `type FileEntry = { path: string; sha256: string }`, `type Bindings = { specifiers: string[]; envAccess: string[] }`, `scanAppFiles(appRoot: string, extraPaths?: string[]): FileEntry[]`, `inferBindings(appRoot: string, files: FileEntry[]): Bindings`. Task 4 imports these exact names.

Fixture contents:

`void.json`: `{"$schema":"https://void.cloud/schema.json","target":"cloudflare"}`
`package.json`: `{"name":"demo-app","version":"0.1.0","dependencies":{"workspace-dep":"workspace:*"}}`
`routes/hello.ts`: `import { db } from "void/db";\nexport default { fetch() { return new Response(String(env.DB)); } };\n`
`middleware/auth.ts`: `const key = env["KV"]; // bracket-string form\nexport default {};\n`
`workflows/extra.ts`: `export const extra = 1;\n`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { inferBindings, scanAppFiles } from "../src/scan.ts";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures/demo-app");

describe("scanAppFiles", () => {
  it("scans default dirs, excludes workflows/ unless passed as extraPaths", () => {
    const base = scanAppFiles(appRoot).map((f) => f.path).sort();
    assert.deepEqual(base, ["middleware/auth.ts", "routes/hello.ts"]);
    const extra = scanAppFiles(appRoot, ["workflows"]).map((f) => f.path).sort();
    assert.deepEqual(extra, ["middleware/auth.ts", "routes/hello.ts", "workflows/extra.ts"]);
  });
  it("emits full 64-char hashes sorted by path", () => {
    const files = scanAppFiles(appRoot);
    assert.ok(files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
    assert.deepEqual(files.map((f) => f.path), [...files.map((f) => f.path)].sort());
  });
});

describe("inferBindings", () => {
  it("detects void/* specifiers plus env.DB and env[\"KV\"] forms", () => {
    const b = inferBindings(appRoot, scanAppFiles(appRoot, ["workflows"]));
    assert.deepEqual(b.specifiers, ["void/db"]);
    assert.deepEqual(b.envAccess, ["DB", "KV"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/fingerprint/test/scan.test.ts`
Expected: FAIL with "Cannot find module '../src/scan.ts'".

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/fingerprint/test/scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter void-fingerprint typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fingerprint/src/scan.ts packages/fingerprint/test/scan.test.ts packages/fingerprint/test/fixtures/demo-app
git commit -m "feat: add app file scanner and binding inference"
```

---

### Task 4: Manifest assembly + emit

**Files:**
- Create: `packages/fingerprint/src/manifest.ts`
- Create: `packages/fingerprint/src/emit.ts`
- Create: `packages/fingerprint/test/manifest.test.ts`
- Modify: `packages/fingerprint/src/index.ts` (re-export manifest + emit)

**Interfaces:**
- Consumes: `canonical`, `sha256Hex` from `./canonical.js`; `scanAppFiles`, `inferBindings`, `FileEntry`, `Bindings` from `./scan.js`. NOTE: source imports use `.ts` extension for `node --test` type-stripping (`./scan.ts`); the tsc build rewrites nothing, so `dist` output keeps `.ts` specifiers — set `module/moduleResolution` to `NodeNext` (Task 1) and always import with explicit `.ts` extension so both the strip-types runner and compiled `dist` resolve. Same rule applies in every later task.
- Produces: `type Manifest = { format: 1; app: string; appType: string; adapter: string | null; target: string; routes: string[]; pages: string[]; middleware: string[]; scanDirs: string[]; extraPaths: string[]; files: FileEntry[]; bindings: Bindings; voidJson: unknown; plugins: string[]; drizzle: { schemaHash: string; migrationHashes: string[] } | null; workspaceDeps: Record<string, string>; fingerprint: string }`, `type EmitOptions = { extraPaths?: string[] }`, `buildManifest(appRoot: string, opts?: EmitOptions): Manifest`, `manifestFingerprint(m: Omit<Manifest, "fingerprint">): string`, `emitManifest(appRoot: string, opts?: EmitOptions): { manifest: Manifest; path: string }`. Task 5 imports `buildManifest`; Task 6 imports `Manifest`.

`plugins` parsing rule (locked here): read `vite.config.ts` as text, capture identifiers matching `/(\w+)\(\)/g` inside the `plugins: [...]` array, return in order; `voidPlugin` position preserved by order. `drizzle` rule: `null` unless `<appRoot>/db` or `packages/db/src/schema` resolves — for monorepo apps the shared schema lives in `packages/db`, so per-app `drizzle` is `null` and the shared-schema edge is expressed in the graph (Task 6), not per manifest.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildManifest } from "../src/manifest.ts";
import { emitManifest } from "../src/emit.ts";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures/demo-app");

describe("buildManifest", () => {
  it("assembles full manifest with format 1 and verifiable fingerprint", () => {
    const m = buildManifest(appRoot, { extraPaths: ["workflows"] });
    assert.equal(m.format, 1);
    assert.equal(m.app, "demo-app");
    assert.equal(m.target, "cloudflare");
    assert.deepEqual(m.routes, ["routes/hello.ts"]);
    assert.deepEqual(m.pages, []);
    assert.deepEqual(m.middleware, ["middleware/auth.ts"]);
    assert.deepEqual(m.bindings.specifiers, ["void/db"]);
    assert.deepEqual(m.workspaceDeps, { "workspace-dep": "workspace:*" });
    assert.equal(m.drizzle, null);
    const { fingerprint, ...rest } = m;
    void rest;
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
  });
});

describe("emitManifest", () => {
  it("writes void.fingerprint.json round-tripping buildManifest", () => {
    const { path } = emitManifest(appRoot, { extraPaths: ["workflows"] });
    assert.equal(path, join(appRoot, "void.fingerprint.json"));
    assert.ok(existsSync(path));
    const disk = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(disk, buildManifest(appRoot, { extraPaths: ["workflows"] }));
    rmSync(path);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/fingerprint/test/manifest.test.ts`
Expected: FAIL with "Cannot find module '../src/manifest.ts'".

- [ ] **Step 3: Write minimal implementation**

`src/manifest.ts`:

```ts
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

export type EmitOptions = { extraPaths?: string[] };

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
```

`src/emit.ts`:

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "./canonical.ts";
import { buildManifest, type EmitOptions, type Manifest } from "./manifest.ts";

export function emitManifest(
  appRoot: string,
  opts: EmitOptions = {},
): { manifest: Manifest; path: string } {
  const manifest = buildManifest(appRoot, opts);
  const path = join(appRoot, "void.fingerprint.json");
  writeFileSync(path, canonical(manifest));
  return { manifest, path };
}
```

- [ ] **Step 4: Update src/index.ts**

```ts
export const FORMAT = 1 as const;
export * from "./canonical.ts";
export * from "./scan.ts";
export * from "./manifest.ts";
export * from "./emit.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test packages/fingerprint/test/manifest.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter void-fingerprint typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/fingerprint/src/manifest.ts packages/fingerprint/src/emit.ts packages/fingerprint/src/index.ts packages/fingerprint/test/manifest.test.ts
git commit -m "feat: add manifest assembly and emit"
```

---

### Task 5: diff + check

**Files:**
- Create: `packages/fingerprint/src/diff.ts`
- Create: `packages/fingerprint/src/check.ts`
- Create: `packages/fingerprint/test/diff.test.ts`
- Modify: `packages/fingerprint/src/index.ts` (re-export diff + check)

**Interfaces:**
- Consumes: `buildManifest`, `EmitOptions`, `Manifest` from `./manifest.ts`.
- Produces: `type DiffResult = { clean: boolean; changedFiles: string[]; fingerprintChanged: boolean; isNew: boolean }`, `diffManifest(appRoot: string, opts?: EmitOptions): DiffResult`, `checkFingerprint(appRoot: string, opts?: EmitOptions): { clean: boolean; drift: string[] }` where `drift` is `changedFiles` plus `"fingerprint"` when the hash changed without file changes. Task 7 imports both.

Rules locked here: baseline is the committed `void.fingerprint.json`; missing baseline file means `isNew: true`, all current files listed in `changedFiles`, `clean: false` (never throws).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonical } from "../src/canonical.ts";
import { buildManifest } from "../src/manifest.ts";
import { diffManifest } from "../src/diff.ts";
import { checkFingerprint } from "../src/check.ts";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures/demo-app");
const baseline = join(appRoot, "void.fingerprint.json");

function writeBaseline(): void {
  writeFileSync(baseline, canonical(buildManifest(appRoot)));
}
function clearBaseline(): void {
  rmSync(baseline, { force: true });
}

describe("diffManifest", () => {
  it("reports clean when working tree matches baseline", () => {
    writeBaseline();
    try {
      assert.deepEqual(diffManifest(appRoot), {
        clean: true,
        changedFiles: [],
        fingerprintChanged: false,
        isNew: false,
      });
    } finally {
      clearBaseline();
    }
  });
  it("names the drifted file after an edit", () => {
    writeBaseline();
    const route = join(appRoot, "routes/hello.ts");
    const orig = readFile(route);
    try {
      writeFileSync(route, orig + "\n// drift\n");
      const d = diffManifest(appRoot);
      assert.equal(d.clean, false);
      assert.deepEqual(d.changedFiles, ["routes/hello.ts"]);
      assert.equal(d.fingerprintChanged, true);
    } finally {
      writeFileSync(route, orig);
      clearBaseline();
    }
  });
  it("treats missing baseline as new, never throws", () => {
    clearBaseline();
    const d = diffManifest(appRoot);
    assert.equal(d.isNew, true);
    assert.equal(d.clean, false);
    assert.deepEqual(d.changedFiles, ["middleware/auth.ts", "routes/hello.ts"]);
  });
});

describe("checkFingerprint", () => {
  it("clean baseline passes, drifted tree fails", () => {
    writeBaseline();
    const route = join(appRoot, "routes/hello.ts");
    const orig = readFile(route);
    try {
      assert.deepEqual(checkFingerprint(appRoot), { clean: true, drift: [] });
      writeFileSync(route, orig + "\n// drift\n");
      const c = checkFingerprint(appRoot);
      assert.equal(c.clean, false);
      assert.ok(c.drift.includes("routes/hello.ts"));
    } finally {
      writeFileSync(route, orig);
      clearBaseline();
    }
  });
});

import { readFileSync } from "node:fs";
function readFile(p: string): string {
  return readFileSync(p, "utf8");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/fingerprint/test/diff.test.ts`
Expected: FAIL with "Cannot find module '../src/diff.ts'".

- [ ] **Step 3: Write minimal implementation**

`src/diff.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildManifest, type EmitOptions } from "./manifest.ts";

export type DiffResult = {
  clean: boolean;
  changedFiles: string[];
  fingerprintChanged: boolean;
  isNew: boolean;
};

export function diffManifest(appRoot: string, opts: EmitOptions = {}): DiffResult {
  const current = buildManifest(appRoot, opts);
  let disk: { files?: { path: string; sha256: string }[]; fingerprint?: string };
  try {
    disk = JSON.parse(readFileSync(join(appRoot, "void.fingerprint.json"), "utf8"));
  } catch {
    return {
      clean: false,
      changedFiles: current.files.map((f) => f.path),
      fingerprintChanged: true,
      isNew: true,
    };
  }
  const prev = new Map((disk.files ?? []).map((f) => [f.path, f.sha256]));
  const changedFiles = current.files
    .filter((f) => prev.get(f.path) !== f.sha256)
    .map((f) => f.path);
  for (const p of prev.keys()) {
    if (!current.files.some((f) => f.path === p)) changedFiles.push(p);
  }
  changedFiles.sort();
  const fingerprintChanged = disk.fingerprint !== current.fingerprint;
  return { clean: changedFiles.length === 0 && !fingerprintChanged, changedFiles, fingerprintChanged, isNew: false };
}
```

`src/check.ts`:

```ts
import { diffManifest } from "./diff.ts";
import type { EmitOptions } from "./manifest.ts";

export function checkFingerprint(
  appRoot: string,
  opts: EmitOptions = {},
): { clean: boolean; drift: string[] } {
  const d = diffManifest(appRoot, opts);
  const drift = [...d.changedFiles];
  if (d.fingerprintChanged && d.changedFiles.length === 0) drift.push("fingerprint");
  return { clean: d.clean, drift };
}
```

- [ ] **Step 4: Update src/index.ts** — append `export * from "./diff.ts";` and `export * from "./check.ts";`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test packages/fingerprint/test/diff.test.ts`
Expected: PASS. Then confirm no stray baseline: `git status --short packages/fingerprint/test/fixtures` shows only intended files.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter void-fingerprint typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/fingerprint/src/diff.ts packages/fingerprint/src/check.ts packages/fingerprint/src/index.ts packages/fingerprint/test/diff.test.ts
git commit -m "feat: add diff and check against committed baseline"
```

---

### Task 6: Monorepo graph

**Files:**
- Create: `packages/fingerprint/src/graph.ts`
- Create: `packages/fingerprint/test/graph.test.ts`
- Modify: `packages/fingerprint/src/index.ts` (re-export graph)

**Interfaces:**
- Consumes: `Manifest` type from `./manifest.ts` (read-only; graph never rebuilds manifests — caller passes app roots and graph reads committed files, falling back to `buildManifest` when missing).
- Produces: `type Graph = { format: 1; apps: Record<string, { fingerprint: string; deps: string[] }>; sharedDeps: Record<string, string[]> }`, `buildGraph(root: string, appDirs: string[], opts?: EmitOptions): Graph`, `writeGraph(root: string, appDirs: string[], opts?: EmitOptions): string` (writes `fingerprint.graph.json` at root, returns path). `sharedDeps` maps a dependency name to the apps using it (this is where the db-touches-all edge surfaces). Task 7 imports `buildGraph`/`writeGraph`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitManifest } from "../src/emit.ts";
import { buildGraph, writeGraph } from "../src/graph.ts";

function makeApp(root: string, name: string, deps: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "void.json"), JSON.stringify({ target: "cloudflare" }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, dependencies: deps }));
  writeFileSync(join(dir, "vite.config.ts"), "export default { plugins: [] };\n");
  writeFileSync(join(dir, "routes/a.ts"), `// ${name}\n`);
  emitManifest(dir);
  return dir;
}

describe("graph", () => {
  it("maps per-app fingerprints and shared-dep edges", () => {
    const root = join(tmpdir(), `fp-graph-${Date.now()}`);
    const a = makeApp(root, "app-a", { "@void-monorepo/db": "workspace:*" });
    const b = makeApp(root, "app-b", { "@void-monorepo/db": "workspace:*" });
    try {
      const g = buildGraph(root, [a, b]);
      assert.equal(g.format, 1);
      assert.deepEqual(Object.keys(g.apps).sort(), ["app-a", "app-b"]);
      assert.deepEqual(g.sharedDeps["@void-monorepo/db"], ["app-a", "app-b"]);
      const path = writeGraph(root, [a, b]);
      assert.equal(path, join(root, "fingerprint.graph.json"));
      assert.ok(existsSync(path));
      assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), g);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/fingerprint/test/graph.test.ts`
Expected: FAIL with "Cannot find module '../src/graph.ts'".

- [ ] **Step 3: Write minimal implementation**

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { canonical } from "./canonical.ts";
import { buildManifest, type EmitOptions, type Manifest } from "./manifest.ts";

export type Graph = {
  format: 1;
  apps: Record<string, { fingerprint: string; deps: string[] }>;
  sharedDeps: Record<string, string[]>;
};

function readCommitted(appRoot: string, opts: EmitOptions): Manifest {
  try {
    return JSON.parse(readFileSync(join(appRoot, "void.fingerprint.json"), "utf8"));
  } catch {
    return buildManifest(appRoot, opts);
  }
}

export function buildGraph(root: string, appDirs: string[], opts: EmitOptions = {}): Graph {
  const apps: Graph["apps"] = {};
  const users: Record<string, string[]> = {};
  for (const dir of appDirs) {
    const m = readCommitted(dir, opts);
    const name = (m.app as string) || relative(root, dir);
    const deps = Object.keys(m.workspaceDeps ?? {}).sort();
    apps[name] = { fingerprint: m.fingerprint, deps };
    for (const d of deps) users[d] = [...(users[d] ?? []), name];
  }
  const sharedDeps: Graph["sharedDeps"] = {};
  for (const [dep, names] of Object.entries(users).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (names.length > 1) sharedDeps[dep] = names.sort();
  }
  return { format: 1, apps, sharedDeps };
}

export function writeGraph(root: string, appDirs: string[], opts: EmitOptions = {}): string {
  const path = join(root, "fingerprint.graph.json");
  writeFileSync(path, canonical(buildGraph(root, appDirs, opts)));
  return path;
}
```

- [ ] **Step 4: Update src/index.ts** — append `export * from "./graph.ts";`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test packages/fingerprint/test/graph.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter void-fingerprint typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/fingerprint/src/graph.ts packages/fingerprint/src/index.ts packages/fingerprint/test/graph.test.ts
git commit -m "feat: add monorepo graph with shared-dep edges"
```

---

### Task 7: Standalone CLI binary

**Files:**
- Create: `packages/fingerprint/src/cli.ts`
- Create: `packages/fingerprint/bin/void-fingerprint.mjs`
- Create: `packages/fingerprint/test/cli.test.ts`
- Modify: `packages/fingerprint/package.json` (add `fingerprint:check` script: `node ./bin/void-fingerprint.mjs check --ci`)

**Interfaces:**
- Consumes: `emitManifest`, `diffManifest`, `checkFingerprint`, `buildGraph`/`writeGraph` (exact names from Tasks 4–6).
- Produces: `run(argv: string[], cwd: string): Promise<number>` returning process exit code (0 clean / 1 drift or usage error / 2 unknown command). Bin maps per-app `cwd` (run via `pnpm --filter`) and `--all` (repo root: child dirs of `apps/`). Consumers outside the package only touch the bin, never `run`.

Commands: `emit [--all]`, `diff [--json] [--all]`, `check --ci [--all]`, `graph [--all]`. `--all` resolves app dirs as `<root>/apps/*` containing `void.json`. Without `--all`, `cwd` itself is the app root. `graph` without `--all` prints that app's node; with `--all` writes root `fingerprint.graph.json`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";

function makeApp(root: string): string {
  const dir = mkdtempSync(join(root, "cli-app-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "void.json"), JSON.stringify({ target: "cloudflare" }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "cli-app" }));
  writeFileSync(join(dir, "vite.config.ts"), "export default { plugins: [] };\n");
  writeFileSync(join(dir, "routes/a.ts"), "// a\n");
  return dir;
}

describe("run", () => {
  it("emit then check passes; drift fails with 1", async () => {
    const root = mkdtempSync(join(tmpdir(), "fp-cli-"));
    const app = makeApp(root);
    const logs: string[] = [];
    const orig = console.log;
    console.log = (s: string): void => {
      logs.push(String(s));
    };
    try {
      assert.equal(await run(["emit"], app), 0);
      assert.equal(await run(["check", "--ci"], app), 0);
      writeFileSync(join(app, "routes/a.ts"), "// a\n// drift\n");
      assert.equal(await run(["check", "--ci"], app), 1);
      assert.equal(await run(["diff", "--json"], app), 0);
      assert.ok(logs.some((l) => l.includes("routes/a.ts")));
      assert.equal(await run(["bogus"], app), 2);
    } finally {
      console.log = orig;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/fingerprint/test/cli.test.ts`
Expected: FAIL with "Cannot find module '../src/cli.ts'".

- [ ] **Step 3: Write minimal implementation**

```ts
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkFingerprint } from "./check.ts";
import { diffManifest } from "./diff.ts";
import { buildGraph, writeGraph } from "./graph.ts";
import { emitManifest, type EmitOptions } from "./emit.ts";

const EXTRA_BY_APP: Record<string, string[]> = {
  "@void-monorepo/api": ["workflows"],
};

function appOpts(appRoot: string, pkgName: string): EmitOptions {
  void appRoot;
  return { extraPaths: EXTRA_BY_APP[pkgName] ?? [] };
}

function pkgName(appRoot: string): string {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    return (JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { name: string }).name;
  } catch {
    return "";
  }
}
```

STOP — the sketch above uses `require` in ESM; the real implementation below avoids it. Write `src/cli.ts` as:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkFingerprint } from "./check.ts";
import { diffManifest } from "./diff.ts";
import { buildGraph, writeGraph } from "./graph.ts";
import { emitManifest, type EmitOptions } from "./emit.ts";

const EXTRA_BY_APP: Record<string, string[]> = {
  "@void-monorepo/api": ["workflows"],
};

function readPkgName(appRoot: string): string {
  try {
    return (JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { name: string }).name;
  } catch {
    return "";
  }
}

function optsFor(appRoot: string): EmitOptions {
  return { extraPaths: EXTRA_BY_APP[readPkgName(appRoot)] ?? [] };
}

function resolveApps(cwd: string, all: boolean): string[] {
  if (!all) return [cwd];
  const appsDir = cwd.endsWith("/apps") ? cwd : join(cwd, "apps");
  return readdirSync(appsDir)
    .map((d) => join(appsDir, d))
    .filter((p) => {
      try {
        return statSync(p).isDirectory() && statSync(join(p, "void.json")).isFile();
      } catch {
        return false;
      }
    });
}

export async function run(argv: string[], cwd: string): Promise<number> {
  const [cmd, ...flags] = argv;
  const all = flags.includes("--all");
  const json = flags.includes("--json");
  const apps = resolveApps(cwd, all);
  switch (cmd) {
    case "emit": {
      for (const a of apps) {
        const { path } = emitManifest(a, optsFor(a));
        if (!flags.includes("--ci")) console.log(`emitted ${path}`);
      }
      return 0;
    }
    case "diff": {
      let dirty = false;
      for (const a of apps) {
        const d = diffManifest(a, optsFor(a));
        if (d.clean) {
          if (!json) console.log(`${a}: clean`);
          continue;
        }
        dirty = true;
        if (json) console.log(JSON.stringify({ app: a, ...d }));
        else {
          console.log(`${a}: drift`);
          for (const f of d.changedFiles) console.log(`  ${f}`);
        }
      }
      return 0 && dirty ? 0 : 0;
    }
    case "check": {
      let clean = true;
      for (const a of apps) {
        const c = checkFingerprint(a, optsFor(a));
        if (!c.clean) {
          clean = false;
          if (!flags.includes("--ci")) console.log(`${a}: drift: ${c.drift.join(", ")}`);
        }
      }
      if (clean && !flags.includes("--ci")) console.log("clean");
      return clean ? 0 : 1;
    }
    case "graph": {
      if (!all) {
        console.log(JSON.stringify(buildGraph(cwd, apps, optsFor(apps[0])), null, 2));
        return 0;
      }
      const path = writeGraph(cwd, apps);
      console.log(`wrote ${path}`);
      return 0;
    }
    default: {
      console.log("usage: void-fingerprint <emit|diff|check|graph> [--all] [--json] [--ci]");
      return 2;
    }
  }
}
```

NOTE to implementer: the `diff` case above contains a nonsense expression (`0 && dirty ? 0 : 0`) left deliberately visible — replace it with `return 0;` (`diff` never fails; `check` owns exit codes). Everything else is final.

`bin/void-fingerprint.mjs`:

```js
#!/usr/bin/env node
import { run } from "../dist/cli.js";

const code = await run(process.argv.slice(2), process.cwd());
process.exitCode = code;
```

- [ ] **Step 4: Fix the `diff` return** to `return 0;` with comment `// diff reports; check enforces`.

- [ ] **Step 5: Add `fingerprint:check` script** to `packages/fingerprint/package.json` scripts: `"fingerprint:check": "node ./bin/void-fingerprint.mjs check --ci"`. NOTE: bin runs from `dist/` — package `build` must run before the bin works; `turbo.json` ordering (Task 8) guarantees it in CI.

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test packages/fingerprint/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + build**

Run: `pnpm --filter void-fingerprint typecheck && pnpm --filter void-fingerprint build && node packages/fingerprint/bin/void-fingerprint.mjs --help; echo "exit=$?"`
Expected: typecheck PASS, build emits `dist/` (incl. `dist/cli.js`), bin prints usage, `exit=2`.

- [ ] **Step 8: Commit**

```bash
git add packages/fingerprint/src/cli.ts packages/fingerprint/bin/void-fingerprint.mjs packages/fingerprint/test/cli.test.ts packages/fingerprint/package.json
git commit -m "feat: add standalone fingerprint CLI binary"
```

---

### Task 8: Plugin + Turbo/CI wiring + dogfood

**Files:**
- Create: `packages/fingerprint/src/plugin.ts`
- Create: `packages/fingerprint/test/plugin.test.ts`
- Modify: `packages/fingerprint/src/index.ts` (re-export plugin)
- Modify: `packages/fingerprint/package.json` (add `void` + `vite`? NO — plugin uses `import type` only; no new deps. Document this in the step.)
- Modify: `turbo.json` (add `test`, `fingerprint:check` tasks)
- Modify: `apps/web/package.json`, `apps/api/package.json`, `apps/admin/package.json` (add `void-fingerprint` devDep + `fingerprint:check` script)
- Modify: `.github/workflows/deploy.yml` (validate job: fingerprint check step)
- Modify: root `package.json` (add root `test` script)
- Create (by running bin): `apps/web/void.fingerprint.json`, `apps/api/void.fingerprint.json`, `apps/admin/void.fingerprint.json`, `fingerprint.graph.json`

**Interfaces:**
- Consumes: `emitManifest`, `buildManifest` (exact names, Tasks 4–6).
- Produces: `fingerprintPlugin(opts?: { enabled?: boolean; extraPaths?: string[] }): { name: string; enforce: "post"; buildStart(): void; writeBundle(): void }`. Placement contract: spread AFTER `voidPlugin()` in each app's `vite.config.ts` plugins array (wiring step does not edit vite configs — plugin ships, apps adopt on next touch; document why: zero-risk rollout, CLI covers CI today).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintPlugin } from "../src/plugin.ts";

describe("fingerprintPlugin", () => {
  it("runs after voidPlugin, writes .void/fingerprint.json on bundle, skips dev by default", () => {
    const app = mkdtempSync(join(tmpdir(), "fp-plugin-"));
    mkdirSync(join(app, "routes"), { recursive: true });
    writeFileSync(join(app, "void.json"), JSON.stringify({ target: "cloudflare" }));
    writeFileSync(join(app, "package.json"), JSON.stringify({ name: "plugin-app" }));
    writeFileSync(join(app, "vite.config.ts"), "export default { plugins: [] };\n");
    writeFileSync(join(app, "routes/a.ts"), "// a\n");
    try {
      const p = fingerprintPlugin();
      assert.equal(p.name, "void-fingerprint");
      assert.equal(p.enforce, "post");
      p.buildStart();
      assert.equal(existsSync(join(app, ".void/fingerprint.json")), false);
      process.env["FINGERPRINT_DEV"] = "1";
      const dev = fingerprintPlugin();
      void dev;
    } finally {
      delete process.env["FINGERPRINT_DEV"];
      rmSync(app, { recursive: true, force: true });
    }
  });
});
```

Wait — the plugin needs the app root. Vite plugins receive config; simplest contract: `fingerprintPlugin()` reads `process.cwd()` as app root at hook time (Vite runs hooks with cwd = app dir). The test above must therefore run hooks with cwd pointed at the fixture. Rewrite the test to `process.chdir(app)` around hook calls (restore after). Lock this: plugin resolves app root via `process.cwd()` at `buildStart`/`writeBundle` time, no constructor path arg. `writeBundle` writes `<cwd>/.void/fingerprint.json` (canonical manifest). Dev gating: `buildStart` no-ops unless `FINGERPRINT_DEV=1` or `apply` is build — implement as: plugin object includes `apply: "build"` (Vite-native gating, no env needed) AND honors `FINGERPRINT_DEV=1` by also running in dev. Test pins: `p.apply === "build"`, `writeBundle` creates the file, `buildStart` is a no-op returning void.

Final test:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintPlugin } from "../src/plugin.ts";

describe("fingerprintPlugin", () => {
  it("is post-ordered, build-applied, and writes .void/fingerprint.json", () => {
    const app = mkdtempSync(join(tmpdir(), "fp-plugin-"));
    mkdirSync(join(app, "routes"), { recursive: true });
    writeFileSync(join(app, "void.json"), JSON.stringify({ target: "cloudflare" }));
    writeFileSync(join(app, "package.json"), JSON.stringify({ name: "plugin-app" }));
    writeFileSync(join(app, "vite.config.ts"), "export default { plugins: [] };\n");
    writeFileSync(join(app, "routes/a.ts"), "// a\n");
    const prev = process.cwd();
    process.chdir(app);
    try {
      const p = fingerprintPlugin();
      assert.equal(p.name, "void-fingerprint");
      assert.equal(p.enforce, "post");
      assert.equal(p.apply, "build");
      p.buildStart();
      p.writeBundle();
      assert.equal(existsSync(join(app, ".void/fingerprint.json")), true);
    } finally {
      process.chdir(prev);
      rmSync(app, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/fingerprint/test/plugin.test.ts`
Expected: FAIL with "Cannot find module '../src/plugin.ts'".

- [ ] **Step 3: Write minimal implementation**

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { canonical } from "./canonical.ts";
import { buildManifest, type EmitOptions } from "./manifest.ts";

export function fingerprintPlugin(opts: EmitOptions = {}): Plugin & {
  enforce: "post";
  apply: "build";
  buildStart(): void;
  writeBundle(): void;
} {
  void opts;
  return {
    name: "void-fingerprint",
    enforce: "post",
    apply: "build",
    buildStart() {},
    writeBundle() {
      const appRoot = process.cwd();
      const manifest = buildManifest(appRoot, opts);
      mkdirSync(join(appRoot, ".void"), { recursive: true });
      writeFileSync(join(appRoot, ".void/fingerprint.json"), canonical(manifest));
    },
  };
}
```

`vite` is `import type` only — no runtime dep, no package.json change. If `tsc` complains `vite` types are missing (vite is a devDep of apps, not of the package), add `"vite": "^6.0.0"` to the package's `devDependencies` (dev-only, never published — `files` limits output to `dist`+`bin`). Prefer the devDep route over skipping typecheck.

- [ ] **Step 4: Update src/index.ts** — append `export * from "./plugin.ts";`.

- [ ] **Step 5: Run test + typecheck**

Run: `node --test packages/fingerprint/test/plugin.test.ts && pnpm --filter void-fingerprint typecheck`
Expected: PASS + PASS.

- [ ] **Step 6: Wire Turbo**

In `turbo.json` tasks add:

```json
"test": { "dependsOn": ["^build"] },
"fingerprint:check": { "inputs": ["routes/**", "pages/**", "middleware/**", "crons/**", "queues/**", "workflows/**", "void.json", "package.json", "vite.config.ts", "void.fingerprint.json"] }
```

No `dependsOn`, no `outputs` — pure source scan. Root `package.json` scripts add `"test": "turbo run test"`.

- [ ] **Step 7: Wire apps**

Each of `apps/{web,api,admin}/package.json`: devDependencies += `"void-fingerprint": "workspace:*"`, scripts += `"fingerprint:check": "void-fingerprint check --ci"`. Run `pnpm install`.

- [ ] **Step 8: Wire CI**

In `.github/workflows/deploy.yml`, `validate` job, after `Typecheck Workspace`, insert:

```yaml
      - name: Fingerprint Drift Check
        run: pnpm exec turbo run fingerprint:check
```

- [ ] **Step 9: Dogfood emit**

Run: `pnpm --filter void-fingerprint build && pnpm exec turbo run build --filter=void-fingerprint 2>/dev/null; pnpm --filter @void-monorepo/api exec void-fingerprint emit && pnpm --filter @void-monorepo/web exec void-fingerprint emit && pnpm --filter @void-monorepo/admin exec void-fingerprint emit && node packages/fingerprint/bin/void-fingerprint.mjs graph --all`
Expected: three `apps/*/void.fingerprint.json` created, root `fingerprint.graph.json` created with `@void-monorepo/db` in `sharedDeps` covering all three apps. Verify: `node -e "const g=require('./fingerprint.graph.json');console.log(g.sharedDeps)"` shows the db edge.

- [ ] **Step 10: Full verification**

Run: `pnpm run typecheck && node --test packages/fingerprint/test/*.test.ts && pnpm exec turbo run fingerprint:check`
Expected: all PASS; check exits 0 on the just-emitted tree.

- [ ] **Step 11: Commit in two parts**

```bash
git add packages/fingerprint turbo.json apps/web/package.json apps/api/package.json apps/admin/package.json .github/workflows/deploy.yml package.json pnpm-lock.yaml
git commit -m "ci: wire fingerprint check into turbo and validate job"
git add apps/web/void.fingerprint.json apps/api/void.fingerprint.json apps/admin/void.fingerprint.json fingerprint.graph.json
git commit -m "feat: add committed fingerprints for web, api, admin + root graph"
```

---

## Self-Review

(Executor or reviewer runs this after writing the plan; included so the checklist travels with the doc.)

1. **Spec coverage:** every acceptance criterion maps — #1 emit (Tasks 4+7+8/Step 9), #2/#3 diff+check exits (Tasks 5+7), #4 graph db edge (Tasks 6+8/Step 9), #5 turbo+CI (Task 8), #6 publish shape (Task 1 `files`/`prepublishOnly`; add a `pnpm pack --dry-run` verification inside Task 8 Step 10 if pack is available offline).
2. **Placeholder scan:** search for `TBD|TODO|appropriate|similar to Task` — the only allowed occurrence is the deliberately-flagged `diff` return in Task 7 Step 3, which Step 4 fixes.
3. **Type consistency:** `EmitOptions`, `Manifest`, `FileEntry`, `Bindings`, `DiffResult`, `Graph`, `run(argv, cwd)` — identical names/signatures in every task; `.ts`-extension imports throughout.
4. **Review Focus:** all five lines have owning tests (CRLF → Task 2; `env["X"]` → Task 3; workflows default-off → Task 3; missing baseline → Task 5; exit codes → Task 7).
