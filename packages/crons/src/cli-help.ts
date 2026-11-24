/**
 * Command docs for the void-crons CLI. Kept as data so `void-crons --help`,
 * `void-crons <command> --help`, and the README stay honest about the same
 * surface. Rendering is pure and works with or without color.
 */

import type { Style } from "./cli-style.js";

export interface CommandDoc {
  name: string;
  summary: string;
  usage: string;
  options: Array<[flag: string, description: string]>;
  example?: string[];
}

const SHARED: Array<[string, string]> = [
  ["--origin URL", "dev server origin (default http://localhost:5173)"],
  ["--token T", "x-void-dev-trigger value (default $VOID_DEV_TRIGGER)"],
  ["--retries N", "retry 429/408/425/5xx/network (default 0); 500ms doubling backoff"],
  ["--timeout MS", "per-attempt HTTP timeout (default 10000)"],
];

const STORE: [string, string] = ["--store MODE", "activity store: sqlite (WAL, default) or jsonl (legacy)"];
const TZ: [string, string] = ["--tz ZONE", "IANA timezone for previews + schedule windows (default UTC)"];
const JSON: [string, string] = ["--json", "machine-readable output"];
const ALL: [string, string] = ["--all", "run across apps/* with a Void config"];

export const COMMANDS: CommandDoc[] = [
  {
    name: "list",
    summary: "scanned jobs, next-fire previews, activity tail",
    usage: "void-crons list [app-path] [--tz ZONE] [--json] [--all]",
    options: [TZ, JSON, ALL],
    example: [
      "void-crons list",
      "void-crons list path/to/app --tz America/New_York",
    ],
  },
  {
    name: "next",
    summary: "preview the next N fire times for an expression or job",
    usage: "void-crons next <expr|job> [app-path] [--count N] [--tz ZONE] [--json]",
    options: [
      ["--count N", "number of upcoming fires to print (default 5, max 50)"],
      TZ,
      JSON,
    ],
    example: [
      'void-crons next "0 9 * * MON" --count 3',
      "void-crons next cleanup path/to/app --tz America/New_York",
    ],
  },
  {
    name: "queues",
    summary: "scan and validate consumers in queues/ (names, options, duplicates)",
    usage: "void-crons queues [app-path] [--json] [--ci]",
    options: [JSON, ["--ci", "quiet on success"], ALL],
    example: ["void-crons queues path/to/app"],
  },
  {
    name: "queue-send",
    summary: "dispatch one batch to the local /__void/queue dev endpoint",
    usage: "void-crons queue-send <queue> [app-path] [--body JSON] [--count N] [--origin URL]",
    options: [
      ["--body JSON", "message body to send (default {})"],
      ["--count N", "number of messages in the batch (default 1, max 100)"],
      ["--origin URL", "loopback dev origin (default http://localhost:5173)"],
      ["--token T", "x-void-dev-trigger value (default $VOID_DEV_TRIGGER)"],
      ["--retries N", "retry 429/408/425/5xx/network (default 0)"],
      ["--timeout MS", "per-attempt HTTP timeout (default 10000)"],
      JSON,
    ],
    example: ['void-crons queue-send emails --body \'{"to":"a@b.c","subject":"Hi"}\''],
  },
  {
    name: "ui",
    summary: "interactive dashboard: trigger, toggle, emit, catch-up, live loop",
    usage: "void-crons ui [app-path] [--tz ZONE] [--store MODE] [--origin URL]",
    options: [TZ, STORE, ...SHARED.slice(0, 2), SHARED[2]!, SHARED[3]!],
    example: ["cd path/to/app && void-crons ui"],
  },
  {
    name: "check",
    summary: "CI gate: invalid jobs, quota profile, manifest drift",
    usage: "void-crons check [app-path] [--limits managed|none] [--no-drift] [--json] [--all]",
    options: [
      ["--limits PROFILE", "managed (100 expr / 1000 sched) or none (default managed)"],
      ["--no-drift", "skip manifest comparison"],
      ["--ci", "quiet on success"],
      JSON,
      ALL,
    ],
    example: ["void-crons check path/to/app --ci"],
  },
  {
    name: "emit",
    summary: "write void.crons.json — local inspection artifact, not deploy config",
    usage: "void-crons emit [app-path] [--ci]",
    options: [["--ci", "quiet on success"]],
  },
  {
    name: "doctor",
    summary: "SDK/config boundaries, bindings note, production-trigger evidence",
    usage: "void-crons doctor [app-path] [--evidence FILE] [--json] [--all]",
    options: [
      ["--evidence FILE", "read accepted production proof for an evidence-backed report"],
      JSON,
      ALL,
    ],
  },
  {
    name: "verify",
    summary: "dispatch one real remote job and write sanitized proof (HITL)",
    usage:
      "void-crons verify [app-path] --origin URL --transport framework --cron EXPR --evidence FILE --allow-remote --confirm-remote-write",
    options: [
      ["--origin URL", "non-loopback HTTPS staging origin"],
      ["--cron EXPR", "expression exported by the app"],
      ["--evidence FILE", "where to write the proof (never stores the secret)"],
      ["--allow-remote", "consent for framework dispatch"],
      ["--confirm-remote-write", "acknowledge a real production job will run"],
    ],
  },
  {
    name: "trigger",
    summary: "fire one job (or expression) right now via POST /__void/scheduled",
    usage: "void-crons trigger <job|expr> [app-path] [--cron EXPR] [options]",
    options: [...SHARED, ["--cron EXPR", "dispatch this expression, not the job's own"], JSON, ALL],
    example: ["void-crons trigger cleanup path/to/app --origin http://localhost:5173"],
  },
  {
    name: "schedule",
    summary: "catch up missed fires (--once) or run a live auto-fire loop",
    usage: "void-crons schedule [app-path] [--once] [--tz ZONE] [options]",
    options: [
      ["--once", "fire the most-recent due per expression in the trailing 24h"],
      TZ,
      ...SHARED.slice(2),
      STORE,
      JSON,
      ALL,
    ],
    example: [
      "void-crons schedule --once --origin http://localhost:5173",
      "void-crons schedule --origin http://localhost:5173",
    ],
  },
];

const DELIVERY: Array<[string, string]> = [
  ["--transport dev|framework", "dev is loopback-only; framework needs HTTPS + CRON_SECRET + --allow-remote"],
  ["--allow-remote", "consent for framework dispatch (not endpoint verification)"],
  ["--confirm-remote-write", "verify only: a real remote job will run"],
  ["--evidence FILE", "read proof for doctor/trigger; write it with verify"],
  ["--binding-mode MODE", "local|remote|unknown assertion; remote needs --allow-remote-bindings"],
  ["--allow-remote-bindings", "consent when bindings are declared remote"],
  ["--limits managed|none", "check quota profile (default managed)"],
];

const QUICK_START = [
  "npm i -g void-crons",
  "cd path/to/your-app",
  "void-crons list",
  "void-crons check && void-crons emit",
  "void-crons trigger cleanup",
  "void-crons ui",
];

function section(title: string, style: Style): string {
  return style.bold(title);
}

export function renderHelp(topic: string | undefined, style: Style): string {
  const known = topic ? COMMANDS.find((command) => command.name === topic) : undefined;
  if (topic && !known) {
    return `unknown help topic "${topic}"\n${renderHelp(undefined, style)}`;
  }
  if (known) {
    const lines: string[] = [
      section(known.name.toUpperCase(), style),
      `  ${known.summary}`,
      "",
      section("USAGE", style),
      `  ${known.usage}`,
      "",
      section("OPTIONS", style),
      ...known.options.map(([flag, description]) => `  ${style.cyan(flag.padEnd(26))} ${description}`),
    ];
    if (known.example?.length) {
      lines.push("", section("EXAMPLES", style), ...known.example.map((line) => `  ${style.dim("$")} ${line}`));
    }
    const dispatch = ["trigger", "schedule", "verify", "ui", "queue-send"].includes(known.name);
    lines.push(
      "",
      `${section("GLOBAL", style)}  --color | --no-color · --help · --version`,
      `  ${style.dim("Tip:")} ${dispatch ? "run void-crons --help for delivery & evidence flags" : "run void-crons doctor to inspect SDK/config boundaries"}.`,
    );
    return lines.join("\n");
  }

  const lines: string[] = [
    section("void-crons", style) + style.dim(" — local lifecycle for Void crons/"),
    "",
    section("USAGE", style),
    "  void-crons <command> [app-path] [options]",
    `  ${style.dim("Commands without an app path use the current directory.")}`,
    "",
    section("COMMANDS", style),
  ];
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  for (const command of COMMANDS) {
    lines.push(`  ${style.cyan(command.name.padEnd(width))}  ${command.summary}`);
  }
  lines.push(
    "",
    section("QUICK START", style),
    ...QUICK_START.map((line, index) => `  ${style.dim(String(index + 1).padStart(2))} ${line}`),
    "",
    section("GLOBAL OPTIONS", style),
    `  ${style.cyan("--help, -h".padEnd(26))} show this help, or help for a command`,
    `  ${style.cyan("--version, -v".padEnd(26))} print the version`,
    `  ${style.cyan("--color | --no-color".padEnd(26))} force or disable ANSI color`,
    `  ${style.cyan("--ci".padEnd(26))} quiet on success`,
    "",
    section("DELIVERY & EVIDENCE", style),
    ...DELIVERY.map(([flag, description]) => `  ${style.cyan(flag.padEnd(26))} ${description}`),
    "",
    `Run ${style.bold("void-crons <command> --help")} for command-specific options.`,
    `Docs: ${style.cyan("https://void.cloud/guide/jobs")}`,
  );
  return lines.join("\n");
}
