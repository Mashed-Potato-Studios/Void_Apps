/**
 * Tiny ANSI style layer shared by the non-interactive CLI commands.
 *
 * Color is opt-in by convention: it is enabled on a TTY, disabled by
 * `NO_COLOR`, forced by `FORCE_COLOR`, and can be overridden explicitly by
 * `--color` / `--no-color`. Keeping this in one place means piped output and
 * test captures stay clean while interactive runs get a little personality.
 */

export interface StyleOptions {
  /** Explicit override (from --color / --no-color, or tests). */
  color?: boolean;
  /** Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Defaults to process.stdout.isTTY. */
  isTTY?: boolean;
}

const ESC = "\u001b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const CYAN = `${ESC}36m`;
const MAGENTA = `${ESC}35m`;

export const GLYPH = {
  active: "●",
  disabled: "○",
  invalid: "✕",
  arrow: "↳",
  ok: "✓",
  warn: "!",
  fail: "✕",
  bullet: "·",
} as const;

export function resolveColor(opts: StyleOptions = {}): boolean {
  if (opts.color !== undefined) return opts.color;
  const env = opts.env ?? process.env;
  const force = env["FORCE_COLOR"];
  if (force !== undefined && force !== "" && force !== "0") return true;
  if (force === "0") return false;
  // NO_COLOR follows the de-facto standard: only a non-empty value disables color.
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  return opts.isTTY ?? process.stdout.isTTY ?? false;
}

export interface Style {
  enabled: boolean;
  bold(text: string): string;
  dim(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  red(text: string): string;
  cyan(text: string): string;
  magenta(text: string): string;
}

function wrap(open: string, close = RESET) {
  return (text: string, enabled: boolean): string => (enabled ? `${open}${text}${close}` : text);
}

const bold = wrap(BOLD);
const dim = wrap(DIM);
const green = wrap(GREEN);
const yellow = wrap(YELLOW);
const red = wrap(RED);
const cyan = wrap(CYAN);
const magenta = wrap(MAGENTA);

export function createStyle(opts: StyleOptions = {}): Style {
  const enabled = resolveColor(opts);
  return {
    enabled,
    bold: (text) => bold(text, enabled),
    dim: (text) => dim(text, enabled),
    green: (text) => green(text, enabled),
    yellow: (text) => yellow(text, enabled),
    red: (text) => red(text, enabled),
    cyan: (text) => cyan(text, enabled),
    magenta: (text) => magenta(text, enabled),
  };
}
