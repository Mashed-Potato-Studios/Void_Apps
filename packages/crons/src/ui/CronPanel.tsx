import type { CSSProperties, ReactNode } from "react";
import type { CronActivityEntry, CronJob } from "../types.js";

export interface CronPanelProps {
  jobs: CronJob[];
  activity?: CronActivityEntry[];
  expressionCount?: number;
  scheduleCount?: number;
  /** Name of the job currently firing; its Run button shows a pending state. */
  triggering?: string | null;
  onToggle?: (jobName: string, disabled: boolean) => void;
  onTrigger?: (job: CronJob) => void;
}

const STATUS_COLOR: Record<CronJob["status"], string> = {
  active: "#10b981",
  disabled: "#9490a5",
  invalid: "#ef4444",
};

const ACTIVITY_COLOR: Record<CronActivityEntry["status"], string> = {
  success: "#10b981",
  failed: "#ef4444",
  skipped: "#f59e0b",
};

const panelStyle: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  border: "1px solid #231f32",
  borderRadius: 16,
  background: "linear-gradient(180deg, #1b1728 0%, #100e18 100%)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.35)",
  color: "#fff",
};

const glossStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, transparent 32%)",
};

const monoStyle: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "0.8rem",
};

const pillStyle: CSSProperties = {
  ...monoStyle,
  fontSize: "0.72rem",
  padding: "0.15rem 0.5rem",
  borderRadius: 999,
  border: "1px solid #37324c",
  background: "#151220",
  color: "#00e5ff",
  whiteSpace: "nowrap",
};

function JobRow({
  job,
  triggering,
  onToggle,
  onTrigger,
}: {
  job: CronJob;
  triggering: string | null;
  onToggle?: (jobName: string, disabled: boolean) => void;
  onTrigger?: (job: CronJob) => void;
}): ReactNode {
  const active = job.status === "active";
  const firing = triggering === job.name;
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.65rem 0",
        borderBottom: "1px solid #231f32",
        flexWrap: "wrap",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: STATUS_COLOR[job.status],
          boxShadow: `0 0 8px ${STATUS_COLOR[job.status]}`,
          flexShrink: 0,
        }}
      />
      <span style={{ ...monoStyle, fontWeight: 600 }}>{job.name}</span>
      {job.status === "invalid" ? (
        <span style={{ color: "#ef4444", fontSize: "0.8rem" }}>
          {job.error ?? "invalid job file"}
        </span>
      ) : (
        <span style={{ display: "inline-flex", gap: "0.35rem", flexWrap: "wrap" }}>
          {job.expressions.map((e) => (
            <code key={e} style={pillStyle}>
              {e}
            </code>
          ))}
        </span>
      )}
      {job.sharedExpression && (
        <span style={{ fontSize: "0.72rem", color: "#f59e0b" }} title="Shares a cron expression with another job file">
          shared
        </span>
      )}
      {!job.usesDefineScheduled && job.status !== "invalid" && (
        <span style={{ fontSize: "0.72rem", color: "#635f75" }} title="Recommended wrapper for typed scheduled events">
          no defineScheduled
        </span>
      )}
      <span style={{ flex: 1 }} />
      {onToggle && job.status !== "invalid" && (
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={`${active ? "Disable" : "Enable"} ${job.name}`}
          onClick={() => onToggle(job.name, active)}
          style={{
            cursor: "pointer",
            borderRadius: 999,
            border: `1px solid ${active ? "#10b981" : "#37324c"}`,
            background: active ? "rgba(16,185,129,0.15)" : "transparent",
            color: active ? "#10b981" : "#9490a5",
            fontSize: "0.72rem",
            fontWeight: 600,
            padding: "0.25rem 0.65rem",
          }}
        >
          {active ? "On" : "Off"}
        </button>
      )}
      {onTrigger && (
        <button
          type="button"
          disabled={!active || firing}
          onClick={() => onTrigger(job)}
          style={{
            cursor: active && !firing ? "pointer" : "not-allowed",
            borderRadius: 6,
            border: "1px solid #37324c",
            background: "#151220",
            color: active ? "#fff" : "#635f75",
            fontSize: "0.72rem",
            fontWeight: 600,
            padding: "0.25rem 0.65rem",
            opacity: firing ? 0.6 : 1,
          }}
        >
          {firing ? "Firing…" : "Run now"}
        </button>
      )}
    </li>
  );
}

export function CronPanel({
  jobs,
  activity = [],
  expressionCount,
  scheduleCount,
  triggering = null,
  onToggle,
  onTrigger,
}: CronPanelProps): ReactNode {
  const active = jobs.filter((j) => j.status === "active").length;
  const disabled = jobs.filter((j) => j.status === "disabled").length;
  const invalid = jobs.filter((j) => j.status === "invalid").length;
  return (
    <section aria-label="Cron jobs" style={panelStyle}>
      <div aria-hidden style={glossStyle} />
      <div style={{ position: "relative", padding: "1.25rem 1.25rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>crons/</h2>
          <span style={{ fontSize: "0.78rem", color: "#9490a5" }}>
            {jobs.length} {jobs.length === 1 ? "job" : "jobs"} · {active} on · {disabled} off
            {invalid > 0 && <span style={{ color: "#ef4444" }}> · {invalid} invalid</span>}
          </span>
          <span style={{ flex: 1 }} />
          {expressionCount !== undefined && (
            <span style={{ ...monoStyle, fontSize: "0.72rem", color: "#635f75" }}>
              {expressionCount}/100 expr · {scheduleCount ?? 0}/1000 sched
            </span>
          )}
        </div>
        {jobs.length === 0 ? (
          <p style={{ color: "#9490a5", fontSize: "0.85rem", margin: "1rem 0 0" }}>
            No cron jobs found. Create <code style={monoStyle}>crons/*.ts</code> with{" "}
            <code style={monoStyle}>export const cron</code> and a default handler.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: "0.5rem 0 0", padding: 0 }}>
            {jobs.map((job) => (
              <JobRow key={job.path} job={job} triggering={triggering} onToggle={onToggle} onTrigger={onTrigger} />
            ))}
          </ul>
        )}
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.72rem", color: "#635f75" }}>
          Off skips local triggers and hides the job from the deploy manifest. Cloudflare triggers can't be
          switched at runtime.
        </p>
      </div>
      <div style={{ position: "relative", borderTop: "1px solid #231f32", padding: "1rem 1.25rem 1.25rem" }}>
        <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", fontWeight: 600, color: "#9490a5" }}>
          activity
        </h3>
        {activity.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#635f75" }}>
            No runs yet — press Run now or fire <code style={monoStyle}>POST /__void/scheduled</code>.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {activity.slice(0, 20).map((entry) => (
              <li
                key={entry.id}
                style={{
                  ...monoStyle,
                  display: "flex",
                  gap: "0.6rem",
                  padding: "0.35rem 0",
                  borderBottom: "1px solid #1a1626",
                  fontSize: "0.76rem",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ color: ACTIVITY_COLOR[entry.status] }}>●</span>
                <span style={{ color: "#fff" }}>{entry.jobName}</span>
                <span style={{ color: "#635f75" }}>{entry.cron}</span>
                <span style={{ color: ACTIVITY_COLOR[entry.status] }}>{entry.status}</span>
                <span style={{ color: "#635f75" }}>{(entry.durationMs / 1000).toFixed(1)}s</span>
                {entry.itemsProcessed !== undefined && (
                  <span style={{ color: "#635f75" }}>items={entry.itemsProcessed}</span>
                )}
                {entry.error && <span style={{ color: "#ef4444" }}>{entry.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
