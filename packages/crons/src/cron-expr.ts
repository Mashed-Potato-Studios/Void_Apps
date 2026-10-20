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
  return cronParserInput(expr) !== null || isExtendedCronEvaluable(expr);
}

/** True when every expression can be previewed locally. */
export function allPreviewSupported(expressions: readonly string[]): boolean {
  return expressions.every(isPreviewSupported);
}

/* ── Quartz fallback evaluator ────────────────────────────────────────────
 * `cron-parser` cannot evaluate `LW`, `<n>W`, or `L-<n>` in day-of-month.
 * Those forms are valid on Cloudflare, so they get a small evaluator here
 * instead of being excluded from previews, catch-up, and the live loop.
 */

type Instant = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** Cloudflare weekday: 1 = Sunday … 7 = Saturday. */
  weekday: number;
};

type DayOfMonthMatcher = (day: number, daysInMonth: number, weekdayOf: (day: number) => number) => boolean;
type DayOfWeekMatcher = (weekday: number, occurrence: number, isLastOccurrence: boolean) => boolean;

type CompiledCron = {
  minutes: Set<number>;
  hours: Set<number>;
  months: Set<number>;
  domAny: boolean;
  dowAny: boolean;
  dom: DayOfMonthMatcher | null;
  dow: DayOfWeekMatcher | null;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsInZone(ms: number, tz: string | undefined): Instant {
  if (tz === undefined || tz === "UTC") {
    const date = new Date(ms);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      weekday: date.getUTCDay() + 1,
    };
  }
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, formatter);
  }
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) values[part.type] = part.value;
  const weekday = DOW_NAMES.indexOf((values["weekday"] ?? "").toUpperCase() as (typeof DOW_NAMES)[number]);
  return {
    year: Number(values["year"]),
    month: Number(values["month"]),
    day: Number(values["day"]),
    hour: Number(values["hour"]),
    minute: Number(values["minute"]),
    weekday: weekday === -1 ? 1 : weekday + 1,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Expand `*`, lists, ranges, and steps into a set. `null` when malformed. */
function expandSet(text: string, min: number, max: number, names?: readonly string[]): Set<number> | null {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const [base, stepText] = part.split("/");
    if (base === undefined || base === "") return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    if (base === "*" || base === "?") {
      for (let value = min; value <= max; value += step) out.add(value);
      continue;
    }
    const tokenValue = (token: string): number | null => {
      if (names) {
        const index = names.indexOf(token.toUpperCase() as (typeof names)[number]);
        if (index !== -1) return index + 1;
      }
      return /^\d+$/.test(token) ? Number(token) : null;
    };
    const bounds = base.split("-");
    if (bounds.length > 2) return null;
    const start = tokenValue(bounds[0] ?? "");
    const end = bounds.length === 2 ? tokenValue(bounds[1] ?? "") : start;
    if (start === null || end === null) return null;
    if (start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) out.add(value);
  }
  return out;
}

function nearestWeekday(day: number, dim: number, weekday: number): number {
  if (weekday === 7) return day > 1 ? day - 1 : day + 2; // Saturday → Friday (or Monday)
  if (weekday === 1) return day < dim ? day + 1 : day - 2; // Sunday → Monday (or Friday)
  return day;
}

function compileDayOfMonth(text: string): { any: boolean; match: DayOfMonthMatcher | null } | null {
  const matchers: DayOfMonthMatcher[] = [];
  let any = false;
  for (const part of text.split(",")) {
    const [base, stepText] = part.split("/");
    if (base === undefined || base === "") return null;
    if (stepText !== undefined) {
      const set = expandSet(part, 1, 31);
      if (!set) return null;
      matchers.push((day) => set.has(day));
      continue;
    }
    if (base === "*" || base === "?") {
      any = true;
      continue;
    }
    if (base === "L") {
      matchers.push((day, dim) => day === dim);
      continue;
    }
    if (base === "LW") {
      matchers.push((day, dim, weekdayOf) => {
        const last = dim;
        return day === nearestWeekday(last, dim, weekdayOf(last));
      });
      continue;
    }
    const offsetLast = /^L-(\d+)$/.exec(base);
    if (offsetLast) {
      const offset = Number(offsetLast[1]);
      matchers.push((day, dim) => day === dim - offset);
      continue;
    }
    const weekdayForm = /^(\d+)W$/.exec(base);
    if (weekdayForm) {
      const target = Number(weekdayForm[1]);
      matchers.push((day, dim, weekdayOf) => day === nearestWeekday(target, dim, weekdayOf(target)));
      continue;
    }
    const set = expandSet(base, 1, 31);
    if (!set) return null;
    matchers.push((day) => set.has(day));
  }
  if (matchers.length === 0) return any ? { any, match: null } : null;
  return {
    any,
    match: (day, dim, weekdayOf) => matchers.some((matcher) => matcher(day, dim, weekdayOf)),
  };
}

function compileDayOfWeek(text: string): { any: boolean; match: DayOfWeekMatcher | null } | null {
  const matchers: DayOfWeekMatcher[] = [];
  let any = false;
  for (const part of text.split(",")) {
    const [base, stepText] = part.split("/");
    if (base === undefined || base === "") return null;
    if (stepText !== undefined) {
      const set = expandSet(part, 1, 7, DOW_NAMES);
      if (!set) return null;
      matchers.push((weekday) => set.has(weekday));
      continue;
    }
    if (base === "*" || base === "?") {
      any = true;
      continue;
    }
    // Bare L in Quartz day-of-week means Saturday (7).
    if (base === "L") {
      matchers.push((weekday) => weekday === 7);
      continue;
    }
    const lastOf = /^([A-Za-z]+|\d+)L$/.exec(base);
    if (lastOf) {
      const set = expandSet(lastOf[1]!, 1, 7, DOW_NAMES);
      if (!set) return null;
      matchers.push((weekday, _occurrence, isLast) => isLast && set.has(weekday));
      continue;
    }
    const nthOf = /^([A-Za-z]+|\d+)#(\d+)$/.exec(base);
    if (nthOf) {
      const set = expandSet(nthOf[1]!, 1, 7, DOW_NAMES);
      const occurrence = Number(nthOf[2]);
      if (!set) return null;
      matchers.push((weekday, index) => index === occurrence && set.has(weekday));
      continue;
    }
    const set = expandSet(base, 1, 7, DOW_NAMES);
    if (!set) return null;
    matchers.push((weekday) => set.has(weekday));
  }
  if (matchers.length === 0) return any ? { any, match: null } : null;
  return { any, match: (weekday, occurrence, isLast) => matchers.some((matcher) => matcher(weekday, occurrence, isLast)) };
}

function compileExtended(expr: string): CompiledCron | null {
  if (validateCloudflareCron(expr) !== null) return null;
  const fields = expr.trim().split(/\s+/);
  const minutes = expandSet(fields[0]!, 0, 59);
  const hours = expandSet(fields[1]!, 0, 23);
  const months = expandSet(fields[3]!, 1, 12, MONTH_NAMES);
  const dom = compileDayOfMonth(fields[2]!);
  const dow = compileDayOfWeek(fields[4]!);
  if (!minutes || !hours || !months || !dom || !dow) return null;
  return {
    minutes,
    hours,
    months,
    domAny: dom.any,
    dowAny: dow.any,
    dom: dom.match,
    dow: dow.match,
  };
}

/** True when the expression needs (and supports) the local Quartz evaluator. */
export function isExtendedCronEvaluable(expr: string): boolean {
  return compileExtended(expr) !== null;
}

const MAX_EXTENDED_ITER = 2000;

/**
 * Due times for expressions the local parser cannot evaluate (`LW`, `<n>W`,
 * `L-<n>`). Evaluates in UTC by default, matching Cloudflare. Returns an
 * empty array when the expression is not evaluable here.
 */
export function extendedDueTimes(
  expr: string,
  fromMs: number,
  toMs: number,
  opts: { tz?: string } = {},
): number[] {
  const compiled = compileExtended(expr);
  if (compiled === null) return [];
  const out: number[] = [];
  const minuteMs = 60_000;
  const start = Math.floor(fromMs / minuteMs) * minuteMs + minuteMs;
  for (let ms = start; ms <= toMs; ms += minuteMs) {
    if (out.length >= MAX_EXTENDED_ITER) break;
    const instant = partsInZone(ms, opts.tz);
    if (!compiled.months.has(instant.month)) continue;
    if (!compiled.hours.has(instant.hour)) continue;
    if (!compiled.minutes.has(instant.minute)) continue;
    const dim = daysInMonth(instant.year, instant.month);
    const weekdayOf = (day: number): number => new Date(Date.UTC(instant.year, instant.month - 1, day)).getUTCDay() + 1;
    const occurrence = Math.floor((instant.day - 1) / 7) + 1;
    const isLast = instant.day + 7 > dim;
    const domOk = compiled.domAny ? true : (compiled.dom?.(instant.day, dim, weekdayOf) ?? false);
    const dowOk = compiled.dowAny ? true : (compiled.dow?.(instant.weekday, occurrence, isLast) ?? false);
    const matches =
      compiled.domAny && compiled.dowAny
        ? true
        : compiled.domAny
          ? dowOk
          : compiled.dowAny
            ? domOk
            : domOk && dowOk;
    if (matches) out.push(ms);
  }
  return out;
}
