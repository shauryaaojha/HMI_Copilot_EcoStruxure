"use client";

/**
 * The foot of the workspace. What it says, left to right: which model is
 * answering, what is selected, what the project holds, and what is wrong
 * with it. It used to say "Hackathon Build".
 *
 * The model badge is the one place the provider decision is visible. A
 * product that silently ran every turn on the smallest model available is
 * how the multi-turn degradation in docs/LLD.md went unnoticed; the bar
 * names the model so that cannot happen quietly again.
 */

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { useProject } from "@/store/project";
import { cn } from "@/components/ui";

interface ProviderInfo {
  provider: "claude" | "gemini" | null;
  model: string | null;
  reason: string;
}

/** What /api/provider says. Null until it answers; the bar says nothing until then. */
function useProviderInfo(): ProviderInfo | null {
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/provider")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (live && body) setInfo(body as ProviderInfo);
      })
      .catch(() => {
        // Unreachable: the bar simply does not claim a model.
      });
    return () => {
      live = false;
    };
  }, []);
  return info;
}

export function StatusBar() {
  const screens = useProject((s) => s.screens);
  const variables = useProject((s) => s.variables);
  const findings = useProject((s) => s.findings);
  const selectedIds = useProject((s) => s.selectedIds);
  const provider = useProviderInfo();

  const objects = screens.reduce((n, s) => n + s.Children[0].Children.length, 0);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  const selected =
    selectedIds.length === 1
      ? screens.flatMap((s) => s.Children[0].Children).find((p) => p.UniqueId === selectedIds[0])
      : undefined;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line-subtle bg-surface-panel px-3 text-[11px] text-text-muted">
      <span className="font-medium text-text-secondary">HMI Copilot</span>

      {provider && (
        <>
          <span aria-hidden className="h-3 w-px bg-line" />
          <span
            title={provider.reason}
            className={cn(
              "flex items-center gap-1.5",
              provider.provider ? "text-text-secondary" : "text-status-warn",
            )}
          >
            <Cpu size={11} aria-hidden />
            <span className="font-mono">{provider.model ?? "no model"}</span>
          </span>
        </>
      )}

      <span aria-hidden className="hidden h-3 w-px bg-line md:block" />
      <span className="hidden min-w-0 truncate md:inline">
        {selected ? (
          <>
            <span className="font-mono text-text-secondary">{selected.Name}</span>
            <span className="text-figure ml-2 text-text-faint">
              {selected.Location.Left}, {selected.Location.Top} · {selected.Width} × {selected.Height}
            </span>
          </>
        ) : selectedIds.length > 1 ? (
          `${selectedIds.length} objects selected`
        ) : (
          <span className="text-text-faint">Nothing selected</span>
        )}
      </span>

      <span className="ml-auto hidden tabular-nums md:inline">
        {screens.length} {screens.length === 1 ? "screen" : "screens"} · {objects}{" "}
        objects · {variables.length} tags
      </span>
      {(errors > 0 || warnings > 0) && (
        <span className="hidden tabular-nums md:inline">
          {errors > 0 && <span className="text-status-alarm">{errors} errors</span>}
          {errors > 0 && warnings > 0 && " · "}
          {warnings > 0 && <span className="text-status-warn">{warnings} warnings</span>}
        </span>
      )}
    </footer>
  );
}
