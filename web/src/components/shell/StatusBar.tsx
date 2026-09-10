"use client";

/** The foot of the workspace - reference screens 5 and 6. */

import { useProject } from "@/store/project";

export function StatusBar() {
  const screens = useProject((s) => s.screens);
  const variables = useProject((s) => s.variables);
  const findings = useProject((s) => s.findings);

  const objects = screens.reduce((n, s) => n + s.Children[0].Children.length, 0);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line-subtle bg-surface-panel px-4 text-[11px] text-text-muted">
      <span className="font-medium text-text-secondary">HMI Copilot v0.1</span>
      <span aria-hidden className="h-3 w-px bg-line" />
      <span>Hackathon Build</span>

      <span aria-hidden className="hidden h-3 w-px bg-line md:block" />
      <span className="hidden tabular-nums md:inline">
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

      <span className="ml-auto hidden lg:inline">
        Accelerating a more sustainable and efficient world.
      </span>
    </footer>
  );
}
