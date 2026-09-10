"use client";

/**
 * Validation results - reference screen 8.
 *
 * Stat tiles across the top, then the findings grouped by severity, each one
 * clickable back to the object or the tag that caused it. Putting the engineer
 * in front of the offending object is the whole point: these are problems that
 * today surface at commissioning, on site, with the panel already mounted.
 *
 * Phase 6 of docs/BUILD_PLAN.md.
 */

import { useState } from "react";
import Link from "next/link";
import { CircleAlert, Info, Play, ShieldCheck, TriangleAlert } from "lucide-react";
import { useProject, type Finding } from "@/store/project";
import { Badge, Button, cn } from "@/components/ui";
import { summarise, useValidation } from "./useValidation";

type Filter = "all" | "error" | "warning" | "info";

const SEVERITY: Record<
  Finding["severity"],
  { icon: typeof CircleAlert; tone: "alarm" | "warn" | "info"; label: string }
> = {
  error: { icon: CircleAlert, tone: "alarm", label: "Error" },
  warning: { icon: TriangleAlert, tone: "warn", label: "Warning" },
  info: { icon: Info, tone: "info", label: "Info" },
};

function Tile({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone: "neutral" | "alarm" | "warn" | "info";
}) {
  const colour = {
    neutral: "text-text-secondary",
    alarm: "text-status-alarm",
    warn: "text-status-warn",
    info: "text-status-info",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "focus-ring flex flex-1 items-center gap-3 rounded-panel border p-3 text-left transition",
        active
          ? "border-brand-400 bg-brand-500/5"
          : "border-line-subtle hover:border-line-strong",
      )}
    >
      <span className={cn("text-2xl font-semibold tabular-nums", colour)}>{count}</span>
      <span className="text-sm text-text-secondary">{label}</span>
    </button>
  );
}

export function ValidationResults({ projectId }: { projectId?: string }) {
  const findings = useProject((s) => s.findings);
  const screens = useProject((s) => s.screens);
  const select = useProject((s) => s.select);
  const { validate, running, error, ranAt } = useValidation();
  const [filter, setFilter] = useState<Filter>("all");

  const counts = summarise(findings);
  const shown = filter === "all" ? findings : findings.filter((f) => f.severity === filter);
  const byId = new Map(
    screens.flatMap((s) => s.Children[0].Children).map((p) => [p.UniqueId, p]),
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-center gap-3">
        <p className="text-sm text-text-muted">
          {ranAt
            ? `Last run ${new Date(ranAt).toLocaleTimeString("en-GB", { hour12: false })}`
            : "Not run yet."}
        </p>
        <Button
          variant="primary"
          className="ml-auto"
          disabled={running}
          onClick={() => void validate()}
          icon={<Play size={15} />}
        >
          {running ? "Running…" : "Run validation"}
        </Button>
      </div>

      {error && (
        <p className="shrink-0 rounded-md border border-status-alarm/40 bg-status-alarm/10 p-3 text-sm text-status-alarm">
          {error}
        </p>
      )}

      <div className="flex shrink-0 gap-3">
        <Tile active={filter === "all"} onClick={() => setFilter("all")} label="All" count={counts.all} tone="neutral" />
        <Tile active={filter === "error"} onClick={() => setFilter("error")} label="Errors" count={counts.errors} tone="alarm" />
        <Tile active={filter === "warning"} onClick={() => setFilter("warning")} label="Warnings" count={counts.warnings} tone="warn" />
        <Tile active={filter === "info"} onClick={() => setFilter("info")} label="Info" count={counts.info} tone="info" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-panel border border-line-subtle">
        {shown.length === 0 ? (
          <p className="flex h-full items-center justify-center gap-2 p-8 text-sm text-text-muted">
            <ShieldCheck size={16} aria-hidden className="text-status-ok" />
            {findings.length === 0 && ranAt
              ? "Nothing to report — the project passes every rule."
              : findings.length === 0
                ? "Run validation to check naming, bindings, types, completeness and standards."
                : "No findings at this severity."}
          </p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {shown.map((finding, i) => {
              const meta = SEVERITY[finding.severity];
              const Icon = meta.icon;
              const part = finding.objectId ? byId.get(finding.objectId) : undefined;

              const row = (
                <>
                  <Icon
                    size={15}
                    aria-hidden
                    className={cn(
                      "mt-0.5 shrink-0",
                      finding.severity === "error"
                        ? "text-status-alarm"
                        : finding.severity === "warning"
                          ? "text-status-warn"
                          : "text-status-info",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary">{finding.message}</p>
                    {finding.suggestion && (
                      <p className="mt-0.5 text-xs text-text-muted">{finding.suggestion}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {finding.rule && <Badge tone="neutral">{finding.rule}</Badge>}
                    {part && <Badge tone="brand">{part.Name}</Badge>}
                    {finding.tag && !part && (
                      <Badge tone="info">{finding.tag}</Badge>
                    )}
                  </div>
                </>
              );

              // A finding about an object is a link back to it; one about a tag
              // has nowhere on the canvas to go, so it stays inert.
              return (
                <li key={`${finding.rule}-${finding.message}-${i}`}>
                  {part && projectId ? (
                    <Link
                      href={`/project/${projectId}`}
                      onClick={() => select([part.UniqueId])}
                      className="flex w-full items-start gap-3 p-3 text-left transition hover:bg-surface-hover"
                    >
                      {row}
                    </Link>
                  ) : part ? (
                    <button
                      type="button"
                      onClick={() => select([part.UniqueId])}
                      className="flex w-full items-start gap-3 p-3 text-left transition hover:bg-surface-hover"
                    >
                      {row}
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 p-3">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
