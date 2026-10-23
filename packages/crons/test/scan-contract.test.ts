import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { scanCronFiles } from "../src/scan.ts";

function withApp(files: Record<string, string>, check: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "cron-contract-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      const path = join(root, "crons", name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const handler = "export default async () => {};";
const schedule = "export const cron = '0 * * * *';";

describe("AST cron export contract", () => {
  for (const initializer of [
    "['0 * * * *', runtimeExpression]",
    "['0 * * * *', ...otherExpressions]",
    "['0 * * * *', , '5 * * * *']",
    "['0 * * * *', 42]",
    "['0 * * * *', '']",
    "['0 * * * *', `5 ${minute} * * *`]",
    "['0 * * * *', ['5 * * * *']]",
    "['0 * * * *', getSchedule('5 * * * *')]",
    "['0 * * * *', '99 * * * *']",
    "[]",
    "runtimeExpression",
  ]) {
    it(`rejects the whole unsupported export: ${initializer}`, () => {
      withApp({ "job.ts": `export const cron = ${initializer}; ${handler}` }, (root) => {
        const [job] = scanCronFiles(root);
        assert.equal(job?.status, "invalid");
        assert.deepEqual(job?.expressions, []);
        assert.ok(job?.error);
      });
    });
  }

  for (const source of [
    `const text = "export const cron = '0 * * * *';";`,
    "const text = `export const cron = '0 * * * *';`;",
    `const pattern = /export const cron = '0 * * * *'/;`,
    `// export const cron = '0 * * * *';`,
    `/* export const cron = '0 * * * *'; */`,
    `namespace Hidden { export const cron = '0 * * * *'; }`,
    `const cron = '0 * * * *'; export type { cron };`,
    `const cron = '0 * * * *'; export { cron };`,
    `const expression = <string>('0 * * * *'); export { expression as cron };`,
  ]) {
    it(`ignores non-runtime or fake exports: ${source}`, () => {
      withApp({ "job.ts": `${source}\n${handler}` }, (root) => {
        assert.match(scanCronFiles(root)[0]?.error ?? "", /missing `export const cron`/);
      });
    });
  }

  for (const source of [
    "export const cron = (`0 * * * *` as const) satisfies string;",
    "export const cron: readonly string[] = ([' 0 * * * * ', ('5 * * * *' as string), `0 * * * *`] as const) satisfies readonly string[];",
    "const unused = 1; export const other = 1, cron = '0 * * * *';",
  ]) {
    it(`accepts literal wrappers and direct exports: ${source}`, () => {
      withApp({ "job.ts": `${source} ${handler}` }, (root) => {
        const [job] = scanCronFiles(root);
        assert.equal(job?.status, "active", job?.error);
        assert.equal(job?.expressions[0], "0 * * * *");
        assert.equal(new Set(job?.expressions).size, job?.expressions.length);
      });
    });
  }

  it("rejects malformed source rather than trusting parser recovery", () => {
    withApp({ "job.ts": `${schedule} ${handler} const broken = ;` }, (root) => {
      assert.match(scanCronFiles(root)[0]?.error ?? "", /invalid cron source/);
    });
  });
});

describe("structural default handler contract", () => {
  for (const source of [
    "",
    "const text = 'export default async () => {}';",
    "const handler = () => {}; export type { handler as default };",
    "export default interface Handler { (): void; }",
    "export default function handler(): void;",
    "declare function handler(): void; export default handler;",
    "interface Handler { (): void; } export default Handler;",
    "import type handler from './unresolved.js'; export default handler;",
    "import { type handler } from './unresolved.js'; export default handler;",
    "export default 42;",
    "export default 'handler';",
    "export default null;",
    "export default undefined;",
    "export default {};",
    "export default [];",
    "namespace Handler {} export default Handler;",
    "enum Handler { Value } export default Handler;",
    "export default class Handler {};",
    "const handler = false; const alias = handler; export { alias as default };",
    "export default (123 as unknown as (() => void));",
    "import { defineScheduled as ds } from 'void/handler'; export default ds({});",
    "import * as sdk from 'void'; export default sdk.defineScheduled();",
  ]) {
    it(`rejects missing or provably noncallable handlers: ${source || "missing"}`, () => {
      withApp({ "job.ts": `${schedule} ${source}` }, (root) => {
        const [job] = scanCronFiles(root, { disabled: ["job"] });
        assert.equal(job?.status, "invalid");
        assert.match(job?.error ?? "", /default handler/);
        assert.deepEqual(job?.expressions, []);
      });
    });
  }

  for (const source of [
    "export default async function run() {};",
    "export default function () {};",
    "const run = async () => {}; const alias = run; export default (alias satisfies Function);",
    "function run() {} export { run as default };",
    "function run(): void; function run() {} export default run;",
    "import handler from './unresolved.js'; export default handler;",
    "export { handler as default } from './unresolved.js';",
    "export default createHandler();",
  ]) {
    it(`allows callable or statically unknown handlers without loading imports: ${source}`, () => {
      withApp({ "job.ts": `${schedule} ${source}` }, (root) => {
        const [job] = scanCronFiles(root);
        assert.equal(job?.status, "active", job?.error);
      });
    });
  }
});

describe("defineScheduled import binding contract", () => {
  for (const source of [
    "import { defineScheduled } from 'void'; export default defineScheduled(async () => {});",
    "import { defineScheduled as ds } from 'void/handler'; export default ds<Bindings>(async () => {});",
    "import * as sdk from 'void/handler'; export default (sdk.defineScheduled)(async () => {});",
    "import * as sdk from 'void'; const alias = sdk; export default alias['defineScheduled'](async () => {});",
    "import { defineScheduled as ds } from 'void'; const alias = ds; export default alias(async () => {});",
  ]) {
    it(`resolves actual SDK bindings: ${source}`, () => {
      withApp({ "job.ts": `${schedule} ${source}` }, (root) => {
        assert.equal(scanCronFiles(root)[0]?.usesDefineScheduled, true);
      });
    });
  }

  for (const source of [
    "defineScheduled(async () => {});",
    "const defineScheduled = (fn) => fn; defineScheduled(async () => {});",
    "import { defineScheduled } from 'not-void'; defineScheduled(async () => {});",
    "import { defineScheduled as ds } from './void'; ds(async () => {});",
    "import * as sdk from 'avoid'; sdk.defineScheduled(async () => {});",
    "import type { defineScheduled } from 'void'; defineScheduled(async () => {});",
    "import { type defineScheduled } from 'void'; defineScheduled(async () => {});",
    "import type * as sdk from 'void'; sdk.defineScheduled(async () => {});",
    "import { defineScheduled } from 'void'; function inner(defineScheduled) { defineScheduled(async () => {}); }",
    "import * as sdk from 'void'; function inner(sdk) { sdk.defineScheduled(async () => {}); }",
    "import { defineScheduled } from 'void'; const text = 'defineScheduled(async () => {})';",
    "const text = \"import { defineScheduled as ds } from 'void'; ds(() => {});\";",
    "import { defineScheduled } from 'void';",
  ]) {
    it(`ignores lookalikes, type imports and shadowed bindings: ${source}`, () => {
      withApp({ "job.ts": `${schedule} ${source} ${handler}` }, (root) => {
        assert.equal(scanCronFiles(root)[0]?.usesDefineScheduled, false);
      });
    });
  }
});

describe("source-only discovery and identity", () => {
  it("invalidates every duplicate extension, even disabled jobs", () => {
    withApp({
      "billing/daily.ts": `${schedule} ${handler}`,
      "billing/daily.mts": `${schedule} ${handler}`,
      "billing/daily.js": `${schedule} ${handler}`,
      "billing/daily.mjs": `${schedule} ${handler}`,
      "daily.ts": `${schedule} ${handler}`,
    }, (root) => {
      const jobs = scanCronFiles(root, { disabled: ["billing/daily"] });
      assert.equal(jobs.length, 5);
      for (const job of jobs.filter((job) => job.name === "billing/daily")) {
        assert.equal(job.status, "invalid");
        assert.match(job.error ?? "", /duplicate cron job name/);
        assert.match(job.error ?? "", /crons\/billing\/daily\.mjs/);
        assert.deepEqual(job.expressions, []);
        assert.equal(job.sharedExpression, false);
      }
      assert.equal(jobs.find((job) => job.name === "daily")?.status, "active");
      assert.equal(jobs.find((job) => job.name === "daily")?.sharedExpression, false);
    });
  });

  it("never executes top-level code, handlers or imported modules", () => {
    withApp({
      "job.ts": `import './_throws.js'; throw new Error('must not execute'); ${schedule} export default () => { throw new Error('must not execute handler'); };`,
      "_throws.js": "throw new Error('must not load imports');",
      "_ignored/job.ts": `${schedule} ${handler}`,
      "job.d.ts": "export declare const cron: string;",
    }, (root) => {
      const jobs = scanCronFiles(root);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.status, "active");
    });
  });
});
