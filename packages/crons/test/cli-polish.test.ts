import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { createStyle, GLYPH, resolveColor } from "../src/cli-style.ts";
import { COMMANDS, renderHelp } from "../src/cli-help.ts";

function capture(fn: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (value?: string): void => {
    lines.push(String(value));
  };
  return fn().then(
    (code) => {
      console.log = original;
      return { code, lines };
    },
    (error) => {
      console.log = original;
      throw error;
    },
  );
}

function emptyApp(): string {
  const dir = mkdtempSync(join(tmpdir(), "crons-polish-"));
  mkdirSync(join(dir, "crons"), { recursive: true });
  return dir;
}

const HEARTBEAT = `export const cron = '* * * * *';\nexport default async () => {};\n`;

describe("cli style", () => {
  it("resolves color from explicit override, FORCE_COLOR, NO_COLOR, then TTY", () => {
    assert.equal(resolveColor({ color: true, env: { NO_COLOR: "1" }, isTTY: false }), true);
    assert.equal(resolveColor({ color: false, env: { FORCE_COLOR: "1" }, isTTY: true }), false);
    assert.equal(resolveColor({ env: { FORCE_COLOR: "1" }, isTTY: false }), true);
    assert.equal(resolveColor({ env: { FORCE_COLOR: "0" }, isTTY: true }), false);
    assert.equal(resolveColor({ env: { NO_COLOR: "" }, isTTY: true }), true);
    assert.equal(resolveColor({ env: { NO_COLOR: "1" }, isTTY: true }), false);
    assert.equal(resolveColor({ env: {}, isTTY: true }), true);
    assert.equal(resolveColor({ env: {}, isTTY: false }), false);
  });

  it("emits ANSI codes only when enabled", () => {
    const on = createStyle({ color: true });
    const off = createStyle({ color: false });
    assert.match(on.bold("x"), /\u001b\[1m/);
    assert.match(on.green("x"), /\u001b\[32m/);
    assert.equal(off.bold("x"), "x");
    assert.equal(off.red("x"), "x");
    assert.equal(GLYPH.active, "●");
  });
});

describe("cli help rendering", () => {
  it("documents every command with a usage line", () => {
    const text = renderHelp(undefined, createStyle({ color: false }));
    for (const command of COMMANDS) {
      assert.match(text, new RegExp(command.name));
    }
    assert.match(text, /QUICK START/);
    assert.match(text, /--version/);
  });

  it("renders command-specific help and an unknown-topic fallback", () => {
    const listHelp = renderHelp("list", createStyle({ color: false }));
    assert.match(listHelp, /void-crons list \[app-path\]/);
    assert.doesNotMatch(listHelp, /QUICK START/);
    const unknown = renderHelp("nope", createStyle({ color: false }));
    assert.match(unknown, /unknown help topic "nope"/);
    assert.match(unknown, /QUICK START/);
  });
});

describe("cli first-run experience", () => {
  it("prints the version and exits 0 for --version and -v", async () => {
    for (const flag of ["--version", "-v"]) {
      const { code, lines } = await capture(() => run([flag], process.cwd()));
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /^void-crons \d+\.\d+\.\d+$/);
    }
  });

  it("prints top-level help and exits 0 (no implicit subcommand)", async () => {
    const { code, lines } = await capture(() => run(["--help"], process.cwd()));
    assert.equal(code, 0);
    assert.match(lines.join("\n"), /QUICK START/);
    assert.match(lines.join("\n"), /COMMANDS/);
  });

  it("prints command help for <command> --help and help <command>", async () => {
    for (const args of [["list", "--help"], ["help", "list"], ["--help", "list"]]) {
      const { code, lines } = await capture(() => run(args, process.cwd()));
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /void-crons list \[app-path\]/);
    }
  });

  it("onboards a fresh app on list, but not in --json or --ci mode", async () => {
    const app = emptyApp();
    try {
      const plain = await capture(() => run(["list", app], process.cwd()));
      assert.equal(plain.code, 0);
      const text = plain.lines.join("\n");
      assert.match(text, /No cron jobs yet/);
      assert.match(text, /crons\/heartbeat\.ts/);
      assert.match(text, /void\.cloud\/guide\/jobs/);

      const json = await capture(() => run(["list", app, "--json"], process.cwd()));
      assert.doesNotMatch(json.lines.join("\n"), /No cron jobs yet/);
      assert.ok(JSON.parse(json.lines.filter((line) => line.startsWith("{")).join("")));

      const ci = await capture(() => run(["list", app, "--ci"], process.cwd()));
      assert.doesNotMatch(ci.lines.join("\n"), /No cron jobs yet/);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("honors --color and --no-color on human-readable output", async () => {
    const app = emptyApp();
    try {
      writeFileSync(join(app, "crons", "heartbeat.ts"), HEARTBEAT);
      const colored = await capture(() => run(["list", app, "--color"], process.cwd()));
      assert.equal(colored.code, 0);
      assert.match(colored.lines.join("\n"), /\u001b\[/);

      const plain = await capture(() => run(["list", app, "--no-color"], process.cwd()));
      assert.equal(plain.code, 0);
      assert.doesNotMatch(plain.lines.join("\n"), /\u001b\[/);
      assert.match(plain.lines.join("\n"), /heartbeat/);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("keeps machine-readable JSON free of ANSI codes even with --color", async () => {
    const app = emptyApp();
    try {
      const { code, lines } = await capture(() => run(["list", app, "--json", "--color"], process.cwd()));
      assert.equal(code, 0);
      const json = lines.filter((line) => line.startsWith("{")).join("");
      assert.doesNotMatch(json, /\u001b\[/);
      assert.ok(JSON.parse(json));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("reports an unknown command with help instead of a bare usage dump", async () => {
    const { code, lines } = await capture(() => run(["frobnicate"], process.cwd()));
    assert.equal(code, 2);
    assert.match(lines.join("\n"), /unknown command "frobnicate"/);
    assert.match(lines.join("\n"), /QUICK START/);
  });

  it("exits 2 for an unknown help topic", async () => {
    const { code, lines } = await capture(() => run(["help", "nope"], process.cwd()));
    assert.equal(code, 2);
    assert.match(lines.join("\n"), /unknown help topic "nope"/);
  });

  it("rejects a missing or swallowed option value", async () => {
    for (const args of [["list", "--tz"], ["list", "--tz", "--json"]]) {
      const { code, lines } = await capture(() => run(args, process.cwd()));
      assert.equal(code, 2, args.join(" "));
      assert.match(lines.join("\n"), /--tz requires a value/);
    }
  });
});

describe("cli next command", () => {
  it("prints upcoming fires for an expression (text and json)", async () => {
    const text = await capture(() => run(["next", "*/5 * * * *", "--count", "3"], process.cwd()));
    assert.equal(text.code, 0);
    assert.match(text.lines.join("\n"), /next 3 fire\(s\) \(UTC\)/);
    assert.equal(text.lines.filter((line) => /^\s{4}\d{4}-/.test(line)).length, 3);

    const json = await capture(() => run(["next", "*/5 * * * *", "--count", "2", "--json"], process.cwd()));
    assert.equal(json.code, 0);
    const out = JSON.parse(json.lines.join(""));
    assert.equal(out.format, 1);
    assert.equal(out.results[0].fires.length, 2);
  });

  it("resolves a job selector from the app and honors --tz", async () => {
    const app = emptyApp();
    try {
      writeFileSync(join(app, "crons", "heartbeat.ts"), HEARTBEAT);
      const { code, lines } = await capture(() => run(["next", "heartbeat", app, "--count", "1", "--tz", "America/New_York", "--json"], process.cwd()));
      assert.equal(code, 0);
      const out = JSON.parse(lines.join(""));
      assert.equal(out.tz, "America/New_York");
      assert.equal(out.results[0].expression, "* * * * *");
      assert.equal(out.results[0].fires.length, 1);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("fails cleanly for an unknown selector or a missing one", async () => {
    const app = emptyApp();
    try {
      const missing = await capture(() => run(["next"], process.cwd()));
      assert.equal(missing.code, 2);
      assert.match(missing.lines.join("\n"), /next needs a cron expression or job name/);

      const unknown = await capture(() => run(["next", "ghost", app], process.cwd()));
      assert.equal(unknown.code, 1);
      assert.match(unknown.lines.join("\n"), /no job "ghost"/);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});
