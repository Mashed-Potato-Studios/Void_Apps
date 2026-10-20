import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allPreviewSupported,
  cfCronToUnix,
  cronParserInput,
  isPreviewSupported,
  validateCloudflareCron,
} from "../src/cron-expr.ts";
import { computeDue } from "../src/schedule.ts";
import { scanCronFiles } from "../src/scan.ts";
import { buildCronManifest } from "../src/manifest.ts";

function makeApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "crons-expr-"));
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, src);
  }
  return dir;
}

const job = (cron: string): string =>
  `export const cron = ${cron};\nexport default async () => {};\n`;

describe("validateCloudflareCron", () => {
  it("accepts every Cloudflare cron form, including Quartz extensions", () => {
    const valid = [
      "* * * * *",
      "*/15 * * * *",
      "0 3 * * *",
      "59 23 LW * *",
      "0 0 L * *",
      "0 0 L-3 * *",
      "0 0 15W * *",
      "0 18 * * 6L",
      "0 9 * * 2#2",
      "0 0 ? * MON",
      "0 9 * * MON-FRI",
      "0 0 * JAN-MAR *",
      "0 0 * * 1,4,7",
      "30 8 * * 2-6/2",
      // Syntactically valid even though June 31 never arrives.
      "0 0 31 6,4 *",
    ];
    for (const expr of valid) {
      assert.equal(validateCloudflareCron(expr), null, `${expr} should be valid`);
    }
  });

  it("rejects out-of-range values and malformed fields", () => {
    const invalid = [
      "0 3 * *",
      "0 3 * * * *",
      "99 99 99 99 99",
      "0 0 1 13 *",
      "0 0 32 * *",
      "* * * * 0", // Cloudflare day-of-week starts at 1
      "* * * * 8",
      "0 0 * * FOO",
      "0 0 * FOO *",
      "0 0 ? ? *", // "?" is day-of-month/day-of-week only
      "0 0 * * 2#6", // occurrence must be 1-5
      "*/0 * * * *",
    ];
    for (const expr of invalid) {
      const problem = validateCloudflareCron(expr);
      assert.ok(problem !== null, `${expr} should be invalid`);
    }
    assert.match(validateCloudflareCron("99 99 99 99 99") ?? "", /invalid cron expression/);
    assert.match(validateCloudflareCron("99 99 99 99 99") ?? "", /99/);
    assert.match(validateCloudflareCron("0 0 1 13 *") ?? "", /invalid cron expression/);
  });
});

describe("cfCronToUnix", () => {
  it("shifts numeric day-of-week values from Quartz to Unix numbering", () => {
    assert.equal(cfCronToUnix("0 12 * * 1"), "0 12 * * 0"); // Sun
    assert.equal(cfCronToUnix("0 12 * * 2"), "0 12 * * 1"); // Mon
    assert.equal(cfCronToUnix("0 0 * * 7"), "0 0 * * 6"); // Sat
    assert.equal(cfCronToUnix("0 9 * * 2-6"), "0 9 * * 1-5"); // Mon-Fri
    assert.equal(cfCronToUnix("0 0 * * 1,4,7"), "0 0 * * 0,3,6");
    assert.equal(cfCronToUnix("30 8 * * 2-6/2"), "30 8 * * 1-5/2");
  });

  it("preserves stars, steps, names, and non-5-field input", () => {
    assert.equal(cfCronToUnix("* * * * *"), "* * * * *");
    assert.equal(cfCronToUnix("0 0 * * */2"), "0 0 * * */2");
    assert.equal(cfCronToUnix("0 12 * * MON"), "0 12 * * MON");
    assert.equal(cfCronToUnix("0 9 * * MON-FRI"), "0 9 * * MON-FRI");
    assert.equal(cfCronToUnix("not-a-cron"), "not-a-cron");
    assert.equal(cfCronToUnix("0 18 * * 6L"), "0 18 * * 5L");
    assert.equal(cfCronToUnix("0 9 * * 2#2"), "0 9 * * 1#2");
  });
});

describe("preview support", () => {
  it("reports which valid expressions the local parser can evaluate", () => {
    assert.equal(isPreviewSupported("0 18 * * 6L"), true);
    assert.equal(isPreviewSupported("0 9 * * 2#2"), true);
    assert.equal(isPreviewSupported("0 0 L * *"), true);
    // Valid on Cloudflare and handled by the Quartz fallback evaluator.
    assert.equal(isPreviewSupported("59 23 LW * *"), true);
    assert.equal(isPreviewSupported("0 0 15W * *"), true);
    assert.equal(isPreviewSupported("0 0 L-3 * *"), true);
    // cron-parser still cannot parse them; the fallback does.
    assert.equal(cronParserInput("59 23 LW * *"), null);
    assert.equal(allPreviewSupported(["0 3 * * *", "15 * * * *"]), true);
    assert.equal(allPreviewSupported(["0 3 * * *", "59 23 LW * *"]), true);
  });
});

describe("computeDue Cloudflare semantics", () => {
  it("previews numeric day-of-week the day Cloudflare fires", () => {
    const from = Date.UTC(2026, 9, 20, 0, 0); // Tuesday 2026-10-20
    const to = from + 7 * 24 * 3600_000;
    // Cloudflare: 5 = Thursday, 6 = Friday.
    assert.equal(new Date(computeDue(["0 18 * * 5"], from, to)[0]!.dueMs).toISOString(), "2026-10-22T18:00:00.000Z");
    assert.equal(new Date(computeDue(["0 18 * * 6"], from, to)[0]!.dueMs).toISOString(), "2026-10-23T18:00:00.000Z");
  });

  it("defaults previews to UTC like Cloudflare", () => {
    const from = Date.UTC(2026, 0, 5, 0, 30);
    const due = computeDue(["0 9 * * *"], from, from + 24 * 3600_000);
    assert.equal(new Date(due[0]!.dueMs).toISOString(), "2026-01-05T09:00:00.000Z");
  });

  it("evaluates Quartz day-of-month forms the parser cannot handle", () => {
    const from = Date.UTC(2026, 9, 1); // 2026-10-01
    const to = Date.UTC(2026, 10, 1); // 2026-11-01

    // October 31 is a Saturday, so the last weekday is Friday the 30th.
    assert.equal(
      new Date(computeDue(["59 23 LW * *"], from, to)[0]!.dueMs).toISOString(),
      "2026-10-30T23:59:00.000Z",
    );
    // Three days before the 31st.
    assert.equal(
      new Date(computeDue(["0 0 L-3 * *"], from, to)[0]!.dueMs).toISOString(),
      "2026-10-28T00:00:00.000Z",
    );

    // November 15 is a Sunday, so 15W resolves to Monday the 16th.
    const novFrom = Date.UTC(2026, 10, 1);
    const novTo = Date.UTC(2026, 11, 1);
    assert.equal(
      new Date(computeDue(["0 0 15W * *"], novFrom, novTo)[0]!.dueMs).toISOString(),
      "2026-11-16T00:00:00.000Z",
    );

    // August 1 is a Saturday, so 1W resolves to Monday the 3rd.
    const augFrom = Date.UTC(2026, 7, 1);
    const augTo = Date.UTC(2026, 8, 1);
    assert.equal(
      new Date(computeDue(["0 0 1W * *"], augFrom, augTo)[0]!.dueMs).toISOString(),
      "2026-08-03T00:00:00.000Z",
    );
  });

  it("evaluates extended forms in an explicit timezone", () => {
    const from = Date.UTC(2026, 9, 1);
    const to = Date.UTC(2026, 10, 1);
    // 23:59 in Tokyo on the last weekday is 14:59 UTC.
    assert.equal(
      new Date(computeDue(["59 23 LW * *"], from, to, { tz: "Asia/Tokyo" })[0]!.dueMs).toISOString(),
      "2026-10-30T14:59:00.000Z",
    );
  });
});

describe("job identity and manifest parity", () => {
  it("names nested jobs by their path inside crons/", () => {
    const app = makeApp({
      "crons/daily.ts": job("'0 4 * * *'"),
      "crons/billing/daily.ts": job("'0 5 * * *'"),
      "crons/billing/_skip.ts": job("'0 6 * * *'"),
    });
    try {
      const jobs = scanCronFiles(app);
      const names = jobs.map((j) => j.name).sort();
      assert.deepEqual(names, ["billing/daily", "daily"]);

      const disabled = scanCronFiles(app, { disabled: ["billing/daily"] });
      const byName = Object.fromEntries(disabled.map((j) => [j.name, j]));
      assert.equal(byName["billing/daily"]?.status, "disabled");
      assert.equal(byName["daily"]?.status, "active");
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("emits schedules in the shape void deploy publishes", () => {
    const app = makeApp({
      "crons/hourly.ts": job("'0 * * * *'"),
      "crons/reports.ts": job("['0 * * * *', '30 9 * * 1']"),
    });
    try {
      const manifest = buildCronManifest(app);
      assert.deepEqual(manifest.schedules, [
        { name: "hourly", cron: "0 * * * *" },
        { name: "reports", cron: "0 * * * *" },
        { name: "reports", cron: "30 9 * * 1" },
      ]);
      assert.equal(manifest.expressionCount, 2);
      assert.equal(manifest.scheduleCount, 3);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("accepts Quartz expressions as valid jobs", () => {
    const app = makeApp({
      "crons/last-weekday.ts": job("'59 23 LW * *'"),
      "crons/second-monday.ts": job("'0 9 * * 2#2'"),
    });
    try {
      const jobs = scanCronFiles(app);
      assert.deepEqual(jobs.map((j) => j.status), ["active", "active"]);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("states that a missing cron export fails the Void build", () => {
    const app = makeApp({ "crons/notes.ts": "export const name = 'x';\n" });
    try {
      const [first] = scanCronFiles(app);
      assert.equal(first?.status, "invalid");
      assert.match(first?.error ?? "", /missing `export const cron`/);
      assert.match(first?.error ?? "", /void build fails/);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});
