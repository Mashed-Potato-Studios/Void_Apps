import type { QueueDefinition } from "../queue-scan.js";
import type { CronActivityEntry } from "../types.js";
import {
  activityRowsForHeight,
  jobRowsForHeight,
  nextActiveFireMs,
  selectedJob,
  visibleJobs,
  type JobView,
  type TuiState,
} from "./model.js";

const ESC = "\u001b[";
const RESET = `${ESC}0m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const INVERT = `${ESC}7m`;

function style(text: string, code: string, color: boolean): string {
  return color ? `${code}${text}${RESET}` : text;
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  const chars = [...text];
  if (chars.length <= width) return text;
  if (width === 1) return "…";
  return `${chars.slice(0, width - 1).join("")}…`;
}

function pad(text: string, width: number): string {
  return truncate(text, width).padEnd(width, " ");
}

function rule(width: number): string {
  return "─".repeat(width);
}

function center(text: string, width: number): string {
  const length = [...text].length;
  return `${" ".repeat(Math.max(0, Math.floor((width - length) / 2)))}${text}`;
}

/** Fills otherwise-empty job rows on tall terminals with a little local flavor. */
const COFFEE_MUG = [
  "      ( (",
  "       ) )",
  "    ...........",
  "    |         |]",
  "    |  VOID   | |",
  "    \\       /",
  "     `-----'",
  "   ~ freshly brewed locally ~",
];

function twoCol(left: string, right: string, width: number): string {
  const l = truncate(left, width);
  const r = truncate(right, width);
  const gap = width - [...l].length - [...r].length;
  if (gap <= 0) return truncate(`${l} ${r}`, width);
  return truncate(`${l}${" ".repeat(gap)}${r}`, width);
}

function originLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock time in the same zone the previews use (UTC unless --tz is set). */
function timeIn(ms: number, tz: string): string {
  let formatter = timeFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    timeFormatters.set(tz, formatter);
  }
  const parts = formatter.formatToParts(new Date(ms));
  const part = (name: string): string => parts.find((item) => item.type === name)?.value ?? "00";
  return `${part("hour")}:${part("minute")}:${part("second")}`;
}

function clock(ms: number, tz: string): string {
  return timeIn(ms, tz);
}

function hhmm(iso: string, tz: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "--:--" : timeIn(date.getTime(), tz).slice(0, 5);
}

function fmtNext(job: JobView, nowMs: number): string {
  if (job.status === "disabled") return "disabled";
  if (job.status === "invalid") return "invalid";
  if (job.nextFireMs === null) return "never";
  const seconds = Math.max(60, Math.round((job.nextFireMs - nowMs) / 1000));
  if (seconds < 120) return "next <2m";
  if (seconds < 5400) return `next ${Math.round(seconds / 60)}m`;
  return `next ${Math.round(seconds / 3600)}h`;
}

function fmtIn(dueMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((dueMs - nowMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 5400) return `${Math.max(1, Math.round(seconds / 60))}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function fmtLast(job: JobView, nowMs: number): string {
  if (!job.last) return "—";
  const finished = new Date(job.last.finishedAt).getTime();
  if (Number.isNaN(finished)) return job.last.status;
  const minutes = Math.max(0, Math.round((nowMs - finished) / 60_000));
  const when = minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
  return `last ${job.last.status === "success" ? "ok" : job.last.status} ${when}`;
}

function markerFor(job: JobView): { text: string; code: string } {
  if (job.status === "active") return { text: "●", code: GREEN };
  if (job.status === "disabled") return { text: "○", code: YELLOW };
  return { text: "✕", code: RED };
}

function detailLine(job: JobView | undefined, nowMs: number, width: number): string {
  if (!job) return pad(" no job selected", width);
  if (job.status === "invalid") {
    return pad(` ${job.path} · invalid · ${job.error ?? "invalid job"}`, width);
  }
  const parts = [job.path, job.status];
  if (job.expressions.length > 0) parts.push(job.expressions.join(", "));
  parts.push(job.usesDefineScheduled ? "defineScheduled" : "bare");
  parts.push(fmtLast(job, nowMs));
  return pad(` ${parts.join(" · ")}`, width);
}

function detailBody(job: JobView | undefined, nowMs: number, width: number, tz: string): string[] {
  if (!job) return [pad(" no job selected", width)];
  const last = job.last;
  const lastLine = last
    ? `${last.status} · ${last.durationMs}ms · ${hhmm(last.finishedAt, tz)} · ${last.source}${
        last.itemsProcessed !== undefined ? ` · items ${last.itemsProcessed}` : ""
      }`
    : "—";
  const error = job.error ?? last?.error;
  return [
    ` path: ${job.path}`,
    ` expressions: ${job.expressions.length > 0 ? job.expressions.join(", ") : "—"}`,
    ` status: ${job.status} · wrapper: ${job.usesDefineScheduled ? "defineScheduled" : "bare"} · shared: ${
      job.sharedExpression ? "yes" : "no"
    }`,
    ` next: ${fmtNext(job, nowMs)} · last: ${lastLine}`,
    ` error: ${error ?? "—"}`,
  ].map((line) => pad(line, width));
}

function jobRow(job: JobView, selected: boolean, width: number, nowMs: number, color: boolean): string {
  const sel = selected ? ">" : " ";
  const marker = markerFor(job);
  const next = fmtNext(job, nowMs);
  const expr = job.status === "invalid" ? (job.error ?? "invalid") : job.expressions.join(", ");

  let line: string;
  if (width >= 70) {
    const nameW = 16;
    const exprW = Math.max(12, Math.floor(width * 0.32));
    const nextW = 14;
    const lastW = Math.max(8, width - nameW - exprW - nextW - 6);
    line = `${sel}${marker.text} ${pad(job.name, nameW)} ${pad(expr, exprW)} ${pad(next, nextW)} ${pad(fmtLast(job, nowMs), lastW)}`;
  } else if (width >= 40) {
    const nameW = Math.max(8, width - 21);
    line = `${sel}${marker.text} ${pad(job.name, nameW)} ${pad(next, 14)}`;
  } else {
    line = `${sel}${marker.text} ${pad(job.name, Math.max(4, width - 12))} ${truncate(next, 8)}`;
  }
  const padded = pad(line, width);
  if (selected) return style(padded, INVERT, color);
  if (!color) return padded;
  const index = padded.indexOf(marker.text);
  if (index === -1) return padded;
  return `${padded.slice(0, index)}${style(marker.text, marker.code, true)}${padded.slice(index + marker.text.length)}`;
}

function activityRow(entry: CronActivityEntry, width: number, tz: string): string {
  const status = entry.kind === "dispatch" && entry.status === "success" ? "ack" : entry.status === "success" ? "ok" : entry.status;
  return pad(
    truncate(`  ↳ ${hhmm(entry.finishedAt, tz)} ${entry.jobName} ${entry.cron} ${status} ${entry.durationMs}ms`, width),
    width,
  );
}

function queueRow(queue: QueueDefinition, selected: boolean, width: number, color: boolean): string {
  const marker = queue.status === "active" ? { text: "●", code: GREEN } : { text: "✕", code: RED };
  const options = Object.entries(queue.options).map(([key, value]) => `${key}=${value}`).join(" ");
  const line = `  ${selected ? ">" : " "}${marker.text} ${pad(queue.name, 22)} ${pad(queue.path, 26)}${options}${queue.error ? ` ${queue.error}` : ""}`;
  const padded = pad(line, width);
  if (selected) return style(padded, INVERT, color);
  if (!color) return padded;
  const index = padded.indexOf(marker.text);
  if (index === -1) return padded;
  return `${padded.slice(0, index)}${style(marker.text, marker.code, true)}${padded.slice(index + marker.text.length)}`;
}

function queuePane(state: TuiState, width: number, rows: number, color: boolean): string[] {
  const lines: string[] = [pad(` Queues (${state.queues.length}) · Q activity`, width)];
  if (state.queues.length === 0) {
    lines.push(pad(" no queues in queues/", width));
  } else {
    const visible = state.queues.slice(0, rows);
    for (let i = 0; i < visible.length; i++) {
      lines.push(queueRow(visible[i]!, i === state.queueSelected, width, color));
    }
  }
  const used = state.queues.length === 0 ? 1 : Math.min(rows, state.queues.length);
  for (let i = used; i < rows; i++) lines.push(" ".repeat(width));
  lines.push(rule(width));
  return lines;
}

function keysLine(state: TuiState, width: number): string {
  if (state.help) return truncate(" ? close · esc close · q quit", width);
  if (state.filterInput) {
    return truncate(` filter: ${state.filter}  · enter apply · esc clear`, width);
  }
  const full = " ↑↓/jk move · PgUp/PgDn page · g/G ends · enter trigger/send · d toggle · e emit · c catch-up · s live · / filter · o sort · v detail · Q queues · ? help · r refresh · q quit";
  const mid = " ↑↓ · ↵ fire · d toggle · e emit · c catchup · s live · / filter · o sort · v · Q queues · ? · r · q";
  const small = " ↑↓ move · ↵ · d e c s / o v Q ? r q";
  return truncate(width >= 112 ? full : width >= 64 ? mid : small, width);
}

function statusLine(state: TuiState, width: number, nowMs: number, color: boolean): string {
  if (state.busy) return pad(` status: ${state.busy}…`, width);
  if (state.status) {
    const label =
      state.status.kind === "error" ? "error: " : state.status.kind === "success" ? "ok: " : "";
    const text = pad(` status: ${label}${state.status.message}`, width);
    if (state.status.kind === "error") return style(text, RED, color);
    if (state.status.kind === "success") return style(text, GREEN, color);
    return text;
  }
  if (state.loop.running) {
    const next = nextActiveFireMs(state);
    const when = next === null ? "next —" : `next in ${fmtIn(next, nowMs)}`;
    return pad(` status: live · ${state.loop.firedTotal} fired · ${when}`, width);
  }
  if (!state.hasToken) {
    return pad(" status: ready · no dev token — restart with --token or set VOID_DEV_TRIGGER", width);
  }
  return pad(" status: ready", width);
}

const HELP_ROWS: Array<[key: string, action: string]> = [
  ["↑↓ / j k", "move selection"],
  ["PgUp/PgDn", "page through jobs"],
  ["g / G", "first / last job"],
  ["enter", "trigger job / send to selected queue"],
  ["d", "toggle enabled (session only)"],
  ["e", "emit manifest (persists toggles)"],
  ["c", "catch up missed fires (24h)"],
  ["s", "start/stop the live loop"],
  ["/", "filter by name, path, or expression"],
  ["o", "cycle sort: next / name / status"],
  ["v", "show job detail"],
  ["Q", "toggle the queues pane"],
  ["?", "toggle this help"],
  ["r", "rescan jobs, manifest, and activity"],
  ["q / Ctrl-C", "quit"],
];

function helpView(state: TuiState, width: number, height: number, nowMs: number, color: boolean, tz: string): string[] {
  const lines: string[] = [
    twoCol(` void-crons · ${state.appName}`, `help · tz ${tz} · ${originLabel(state.origin)}`, width),
    rule(width),
  ];
  const available = Math.max(0, height - lines.length - 2);
  for (let i = 0; i < available; i++) {
    const [key, action] = HELP_ROWS[i] ?? ["", ""];
    lines.push(pad(`  ${key.padEnd(12)} ${action}`, width));
  }
  lines.push(pad(keysLine(state, width), width));
  lines.push(statusLine(state, width, nowMs, color));
  return lines;
}

export function render(state: TuiState, nowMs: number, color = state.color): string[] {
  const width = Math.max(20, state.width);
  const height = Math.max(8, state.height);
  const zone = state.tz ?? "UTC";
  if (state.help) return helpView(state, width, height, nowMs, color, zone);

  const lines: string[] = [];
  const active = state.jobs.filter((job) => job.status === "active");
  const expressions = new Set(active.flatMap((job) => job.expressions)).size;
  const schedules = active.reduce((count, job) => count + job.expressions.length, 0);
  const manifestNote =
    state.manifest === "drift" ? `manifest drift (${state.drift.length})` : `manifest ${state.manifest}`;
  const loopLabel = state.loop.running ? `loop LIVE · ${state.loop.firedTotal} fired` : "loop off";

  lines.push(
    twoCol(
      ` void-crons · ${state.appName}`,
      `${loopLabel} · tz ${zone} · ${state.storeMode} · ${originLabel(state.origin)}`,
      width,
    ),
  );
  lines.push(
    twoCol(
      ` ${state.jobs.length} jobs · ${expressions} expr · ${schedules} sched${width >= 100 ? ` · ${state.queues.length} queue(s)` : ""} · sort ${state.sort}`,
      `${manifestNote} · scan ${clock(state.scannedAt, zone)}`,
      width,
    ),
  );
  lines.push(rule(width));

  const rows = jobRowsForHeight(height);
  const visible = visibleJobs(state);
  const viewport = visible.slice(state.scroll, state.scroll + rows);
  const selectedIndex = state.selected - state.scroll;
  const blankRows = rows - visible.length;
  const mugStart = state.filter.length === 0 && visible.length > 0 && width >= 70 && height >= 30 &&
    blankRows >= COFFEE_MUG.length + 2
    ? visible.length + Math.floor((blankRows - COFFEE_MUG.length) / 2)
    : -1;
  for (let i = 0; i < rows; i++) {
    const job = viewport[i];
    if (!job) {
      if (mugStart >= 0 && i >= mugStart && i - mugStart < COFFEE_MUG.length) {
        lines.push(pad(center(COFFEE_MUG[i - mugStart]!, width), width));
      } else if (visible.length === 0 && i === 0) {
        const message = state.filter.length > 0 ? ` no jobs match "${state.filter}"` : " no jobs in crons/";
        lines.push(pad(message, width));
      } else if (visible.length === 0 && i === 1 && state.filter.length === 0) {
        lines.push(pad(" add a file to crons/ — see void-crons --help", width));
      } else {
        lines.push(" ".repeat(width));
      }
      continue;
    }
    lines.push(jobRow(job, i === selectedIndex, width, nowMs, color));
  }
  lines.push(detailLine(selectedJob(state), nowMs, width));
  lines.push(rule(width));

  const activityRows = activityRowsForHeight(height);
  if (activityRows > 0) {
    if (state.pane === "queues" && !state.detail) {
      lines.push(...queuePane(state, width, activityRows, color));
    } else if (state.detail) {
      lines.push(pad(" Detail · v close", width));
      const body = detailBody(selectedJob(state), nowMs, width, zone);
      for (let i = 0; i < activityRows; i++) lines.push(body[i] ?? " ".repeat(width));
      lines.push(rule(width));
    } else {
      lines.push(
        pad(
          state.drift.length > 0 ? ` Drift (${state.drift.length}) · Activity` : " Activity",
          width,
        ),
      );
      const drift = state.drift.slice(0, activityRows);
      for (const line of drift) lines.push(pad(`  ${line}`, width));
      const entries = state.activity.slice(0, activityRows - drift.length);
      for (const entry of entries) lines.push(activityRow(entry, width, zone));
      const used = drift.length + entries.length;
      for (let i = used; i < activityRows; i++) lines.push(" ".repeat(width));
      lines.push(rule(width));
    }
  }

  lines.push(pad(keysLine(state, width), width));
  lines.push(statusLine(state, width, nowMs, color));
  return lines.slice(0, height);
}
