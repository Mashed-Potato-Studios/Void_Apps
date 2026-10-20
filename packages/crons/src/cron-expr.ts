import { CronExpressionParser } from "cron-parser";

/**
 * Cloudflare cron grammar + preview normalization.
 *
 * Cloudflare Cron Triggers are Quartz-flavoured and UTC-only:
 * - day-of-week is `1 = Sunday … 7 = Saturday` (not Unix `0 = Sunday`),
 * - `L`, `LW`, `<n>W`, `<n>L`, `<n>#<k>` and `?` are supported,
 * - schedules always evaluate in UTC.
 *
 * `cron-parser` (and therefore every preview/catch-up path) expects Unix
 * day-of-week numbering, so expressions must be normalized before parsing.
 * The Void platform does the same conversion in its own scheduler.
 */

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
/** Cloudflare day names, index 0 = Sunday (Cloudflare value 1). */
const DOW_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

const FIELD_NAMES = ["minute", "hour", "day-of-month", "month", "day-of-week"] as const;
type Field = 0 | 1 | 2 | 3 | 4;

const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [1, 7],
];

function atomValue(token: string, field: Field): number | null {
  const upper = token.toUpperCase();
  if (field === 3) {
    const index = MONTH_NAMES.indexOf(upper as (typeof MONTH_NAMES)[number]);
    if (index !== -1) return index + 1;
  }
  if (field === 4) {
    const index = DOW_NAMES.indexOf(upper as (typeof DOW_NAMES)[number]);
    if (index !== -1) return index + 1;
  }
  if (!/^\d+$/.test(token)) return null;
  return Number(token);
}

function checkAtom(token: string, field: Field): string | null {
  const [min, max] = FIELD_RANGES[field]!;
  const value = atomValue(token, field);
  if (value === null) {
    return field === 4
      ? `unknown day-of-week "${token}" (expected 1-7, SUN-SAT, or a day name)`
      : field === 3
        ? `unknown month "${token}" (expected 1-12 or JAN-DEC)`
        : `invalid ${FIELD_NAMES[field]} "${token}"`;
  }
  if (value < min || value > max) {
    return `${FIELD_NAMES[field]} ${value} out of range ${min}-${max}`;
  }
  return null;
}

function checkField(field: Field, text: string): string | null {
  for (const part of text.split(",")) {
    if (part === "") return `empty ${FIELD_NAMES[field]} list item`;
    const pieces = part.split("/");
    if (pieces.length > 2) return `invalid step in "${part}"`;
    const base = pieces[0] ?? "";
    const step = pieces[1];
    if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) {
      return `invalid step "${step}" in "${part}"`;
    }

    if (base === "?") {
      if (field === 2 || field === 4) continue;
      return `"?" is only valid in day-of-month or day-of-week`;
    }
    if (base === "*") continue;

    if (field === 2) {
      if (base === "L" || base === "LW") continue;
      const offsetLast = /^L-(\d+)$/.exec(base);
      if (offsetLast) {
        const offset = Number(offsetLast[1]);
        if (offset >= 1 && offset <= 30) continue;
        return `invalid day-of-month token "${base}"`;
      }
      const nearestWeekday = /^(\d+)W$/.exec(base);
      if (nearestWeekday) {
        const day = Number(nearestWeekday[1]);
        if (day >= 1 && day <= 31) continue;
        return `day-of-month ${day} out of range 1-31`;
      }
    }

    if (field === 4) {
      // Bare `L` means the last day of the week (Saturday) in Quartz.
      if (base === "L") continue;
      const lastOf = /^([A-Za-z]+|\d+)L$/.exec(base);
      if (lastOf) {
        const problem = checkAtom(lastOf[1]!, field);
        if (problem) return problem;
        continue;
      }
      const nthOf = /^([A-Za-z]+|\d+)#(\d+)$/.exec(base);
      if (nthOf) {
        const problem = checkAtom(nthOf[1]!, field);
        if (problem) return problem;
        const nth = Number(nthOf[2]);
        if (nth >= 1 && nth <= 5) continue;
        return `invalid occurrence "${base}" (expected #1-#5)`;
      }
    }

    if (base.includes("-")) {
      const bounds = base.split("-");
      if (bounds.length !== 2 || !bounds[0] || !bounds[1]) {
        return `invalid range "${base}"`;
      }
      for (const bound of bounds) {
        const problem = checkAtom(bound, field);
        if (problem) return problem;
      }
      continue;
    }

    const problem = checkAtom(base, field);
    if (problem) return problem;
  }
  return null;
}

/**
 * Validate an expression against Cloudflare's Cron Trigger grammar.
 * Returns `null` when valid, otherwise a human-readable reason.
 *
 * This is deliberately grammar-level: it checks field shape, ranges and the
 * Quartz extensions Cloudflare supports. It does not require the expression
 * to be previewable locally (see {@link isPreviewSupported}).
 */
export function validateCloudflareCron(expr: string): string | null {
  const trimmed = expr.trim();
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return `unsupported cron expression: "${expr}" (expected 5-field cron)`;
  }
  for (let index = 0; index < fields.length; index++) {
    const problem = checkField(index as Field, fields[index]!);
    if (problem !== null) return `invalid cron expression: "${expr}" (${problem})`;
  }
  return null;
}

/** Convert a Cloudflare day-of-week value (1=Sun…7=Sat) to Unix (0=Sun…6=Sat). */
function shiftDayOfWeek(value: string): string {
  const match = /^(\d+)(.*)$/.exec(value);
  if (!match) return value; // name (MON), "?", "L"
  const day = Math.max(0, Number(match[1]) - 1);
  return `${day}${match[2]}`;
}

/**
 * Rewrite Cloudflare numeric day-of-week values to Unix numbering so
 * `cron-parser` evaluates the same day Cloudflare will. Names, `L` and `#`
 * suffixes pass through unchanged; non-5-field input is returned as-is.
 */
export function cfCronToUnix(expr: string): string {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return expr;
  fields[4] = (fields[4] ?? "")
    .split(",")
    .map((part) => {
      const [rangeOrValue, step] = part.split("/");
      const stepSuffix = step !== undefined ? `/${step}` : "";
      if (rangeOrValue === "*") return `*${stepSuffix}`;
      if (rangeOrValue!.includes("-")) {
        const [start, end] = rangeOrValue!.split("-").map(shiftDayOfWeek);
        return `${start}-${end}${stepSuffix}`;
      }
      return `${shiftDayOfWeek(rangeOrValue!)}${stepSuffix}`;
    })
    .join(",");
  return fields.join(" ");
}

/**
 * The expression to hand to `cron-parser`, or `null` when the local parser
 * cannot evaluate it (for example `LW`, `15W`, `L-3`).
 *
 * Callers must treat `null` as "valid but not previewable" — never as an
 * invalid job.
 */
export function cronParserInput(expr: string): string | null {
  const normalized = cfCronToUnix(expr);
  try {
    CronExpressionParser.parse(normalized);
    return normalized;
  } catch {
    return null;
  }
}

/** True when a local preview (next-fire, catch-up, live loop) can be computed. */
export function isPreviewSupported(expr: string): boolean {
  return cronParserInput(expr) !== null;
}

/** True when every expression can be previewed locally. */
export function allPreviewSupported(expressions: readonly string[]): boolean {
  return expressions.every(isPreviewSupported);
}
