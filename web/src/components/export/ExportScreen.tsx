"use client";

/**
 * Generate & Export - reference screen 9.
 *
 * What the project contains, what validation says about it, what will be
 * written, and the files themselves. The .eote comes from /api/export, which
 * runs the same packager that produced demo_project/HMICopilot_TS.eote - a file
 * that opens in EcoStruxure Operator Terminal Expert 4.4.
 *
 * Phase 7 of docs/BUILD_PLAN.md - the moment the whole pitch rests on.
 */

import { useEffect, useState } from "react";
import {
  CircleAlert,
  Download,
  FileSpreadsheet,
  Package,
  ShieldCheck,
  TriangleAlert,
  ClipboardCheck,
} from "lucide-react";
import { useProject } from "@/store/project";
import { summarise, useValidation } from "@/components/validation/useValidation";
import { Badge, Button, Panel, Toggle, cn } from "@/components/ui";
import { useExport } from "./useExport";

const kb = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

export function ExportScreen() {
  const name = useProject((s) => s.name);
  const target = useProject((s) => s.target);
  const screens = useProject((s) => s.screens);
  const variables = useProject((s) => s.variables);
  const alarms = useProject((s) => s.alarms);
  const bindings = useProject((s) => s.bindings);
  const findings = useProject((s) => s.findings);

  const { validate, running: validating, ranAt } = useValidation();
  const { state, artifacts, build } = useExport();

  const [wantEote, setWantEote] = useState(true);
  const [wantCsv, setWantCsv] = useState(true);
  const [wantReport, setWantReport] = useState(true);

  const counts = summarise(findings);
  const objects = screens.reduce((n, s) => n + s.Children[0].Children.length, 0);
  const building = state.status === "building";

  // Validate once on arrival, so the gate below is answering with real findings
  // rather than with an empty array that looks like a pass.
  useEffect(() => {
    if (!ranAt) void validate();
  }, [ranAt, validate]);

  const facts: [string, string][] = [
    ["Project", name],
    ["Target", `${target.model} · ${target.width} × ${target.height}`],
    ["Screens", String(screens.length)],
    ["Objects", String(objects)],
    ["Variables", String(variables.length)],
    ["Alarms", String(alarms.length)],
    ["Bindings", String(bindings.length)],
  ];

  return (
    <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <Panel title="What will be written" bordered>
          <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {facts.map(([key, value]) => (
              <div key={key} className="border-b border-line-subtle py-2">
                <dt className="text-xs text-text-muted">{key}</dt>
                <dd className="truncate text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel
          title="Validation"
          bordered
          actions={
            <Button
              variant="ghost"
              size="sm"
              disabled={validating}
              onClick={() => void validate()}
            >
              {validating ? "Checking…" : "Re-run"}
            </Button>
          }
        >
          {counts.errors > 0 ? (
            <p className="flex items-start gap-2 rounded-md border border-status-alarm/40 bg-status-alarm/10 p-3 text-sm text-status-alarm">
              <CircleAlert size={15} aria-hidden className="mt-px shrink-0" />
              <span>
                {counts.errors} {counts.errors === 1 ? "error" : "errors"} — the file
                will still be written, but fix these before the project goes to a
                panel.
              </span>
            </p>
          ) : counts.warnings > 0 ? (
            <p className="flex items-start gap-2 rounded-md border border-status-warn/40 bg-status-warn/10 p-3 text-sm text-status-warn">
              <TriangleAlert size={15} aria-hidden className="mt-px shrink-0" />
              <span>
                {counts.warnings} {counts.warnings === 1 ? "warning" : "warnings"} —
                worth a look, none of them blocking.
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-2 rounded-md border border-status-ok/40 bg-status-ok/10 p-3 text-sm text-status-ok">
              <ShieldCheck size={15} aria-hidden />
              {ranAt ? "Passes every rule." : "Not checked yet."}
            </p>
          )}
        </Panel>

        <Panel title="Files to generate" bordered>
          <div className="space-y-3">
            <label className="flex items-start gap-3 rounded-md border border-line p-3">
              <Toggle
                checked={wantEote}
                onChange={setWantEote}
                label="EcoStruxure project (.eote)"
                labelHidden
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  EcoStruxure project (.eote)
                </span>
                <span className="block text-xs text-text-muted">
                  Screens, variables, alarms and the binding graph, packaged the way
                  the product writes them.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-md border border-line p-3">
              <Toggle
                checked={wantCsv}
                onChange={setWantCsv}
                label="Variables (.csv)"
                labelHidden
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">Variables (.csv)</span>
                <span className="block text-xs text-text-muted">
                  The tag list, in the columns our own importer reads back.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-md border border-line p-3">
              <Toggle
                checked={wantReport}
                onChange={setWantReport}
                label="Validation report (.html)"
                labelHidden
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  Validation report (.html)
                </span>
                <span className="block text-xs text-text-muted">
                  Every finding with the object that caused it. Opens with no
                  internet, so it can be read on a commissioning laptop.
                </span>
              </span>
            </label>

            <Button
              variant="primary"
              size="lg"
              block
              disabled={building || (!wantEote && !wantCsv && !wantReport)}
              onClick={() =>
                void build({ eote: wantEote, csv: wantCsv, report: wantReport })
              }
              icon={<Package size={16} />}
            >
              {building ? "Generating…" : "Generate files"}
            </Button>
          </div>
        </Panel>
      </div>

      <Panel title="Export preview" bordered className="min-h-0">
        {state.status === "failed" && (
          <div
            className={cn(
              "mb-3 rounded-md border p-3 text-xs",
              state.setup
                ? "border-status-warn/40 bg-status-warn/10 text-status-warn"
                : "border-status-alarm/40 bg-status-alarm/10 text-status-alarm",
            )}
          >
            <p className="font-medium">
              {state.setup ? "The .eote needs a project skeleton" : "Export failed"}
            </p>
            <p className="mt-1 opacity-90">{state.message}</p>
            {state.setup && (
              <p className="mt-2 opacity-90">
                The skeleton is extracted per machine from a local EcoStruxure
                installation and is never committed — those are Schneider&apos;s
                files. Anything else selected above was still written.
              </p>
            )}
          </div>
        )}

        {artifacts.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nothing generated yet. Choose what you need and press Generate files.
          </p>
        ) : (
          <ul className="space-y-2">
            {artifacts.map((artifact) => (
              <li
                key={artifact.name}
                className="flex items-center gap-3 rounded-md border border-line bg-surface-raised p-3"
              >
                {artifact.kind === "eote" ? (
                  <Package size={18} aria-hidden className="shrink-0 text-brand-400" />
                ) : artifact.kind === "report" ? (
                  <ClipboardCheck
                    size={18}
                    aria-hidden
                    className="shrink-0 text-status-info"
                  />
                ) : (
                  <FileSpreadsheet
                    size={18}
                    aria-hidden
                    className="shrink-0 text-status-ok"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {artifact.name}
                  </span>
                  <span className="block text-xs tabular-nums text-text-muted">
                    {kb(artifact.bytes)}
                  </span>
                </span>
                <a
                  href={artifact.url}
                  download={artifact.name}
                  className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-text-secondary transition hover:border-line-strong hover:text-text-primary"
                >
                  <Download size={13} aria-hidden />
                  Save
                </a>
              </li>
            ))}
          </ul>
        )}

        {artifacts.some((a) => a.kind === "eote") && (
          <p className="mt-3 flex items-start gap-2 text-xs text-text-muted">
            <Badge tone="ok">verified</Badge>
            <span>
              Written by the same packager that produced
              demo_project/HMICopilot_TS.eote, which opens in Operator Terminal
              Expert 4.4.
            </span>
          </p>
        )}
      </Panel>
    </div>
  );
}
