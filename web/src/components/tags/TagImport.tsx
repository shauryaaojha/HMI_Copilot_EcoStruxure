"use client";

/**
 * The drop zone, the file card and what the import changed.
 * Reference screen 3 of docs/ui-reference/04-screen-map.png.
 *
 * lib/tags/parse.ts corrects names rather than rejecting rows, and reports
 * every correction. Showing them is the point: an engineer whose tag is called
 * "2ND PUMP RUN" needs to know it became "_2ND_PUMP_RUN" before it appears in
 * a binding, not after.
 *
 * Phase 3 of docs/BUILD_PLAN.md.
 */

import { useRef, useState } from "react";
import { CircleAlert, FileSpreadsheet, Loader, TriangleAlert, Upload } from "lucide-react";
import { useProject } from "@/store/project";
import { Badge, Button, Panel, cn } from "@/components/ui";
import { ACCEPTED, useTagImport } from "./useTagImport";

export function TagImport({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { state, upload } = useTagImport();
  const tagImport = useProject((s) => s.tagImport);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const busy = state.status === "parsing";

  function take(files: FileList | null) {
    const file = files?.[0];
    if (file) void upload(file);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-md border border-dashed transition",
          over ? "border-brand-500 bg-brand-500/5" : "border-line",
        )}
      >
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className={cn(
            "focus-ring flex w-full flex-col items-center gap-1.5 rounded-md text-center text-xs text-text-muted transition hover:text-text-secondary disabled:opacity-60",
            compact ? "p-5" : "p-10",
          )}
        >
          {busy ? (
            <Loader size={compact ? 18 : 22} aria-hidden className="animate-spin text-brand-400" />
          ) : (
            <Upload size={compact ? 18 : 22} aria-hidden />
          )}
          <span className={cn(!compact && "text-sm font-medium text-text-primary")}>
            {busy ? "Parsing and analysing tags…" : "Drag and drop your file here"}
          </span>
          <span className="text-text-faint">
            {busy ? state.fileName : "or click to browse — .csv · .txt · .xlsx"}
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {state.status === "failed" && (
        <p className="flex items-start gap-2 rounded-md border border-status-alarm/40 bg-status-alarm/10 p-3 text-xs text-status-alarm">
          <CircleAlert size={14} aria-hidden className="mt-px shrink-0" />
          <span>
            <span className="font-medium">{state.fileName}</span> — {state.message}
          </span>
        </p>
      )}

      {tagImport && (
        <div className="flex items-center gap-3 rounded-md border border-line bg-surface-raised p-3">
          <FileSpreadsheet size={20} aria-hidden className="shrink-0 text-status-ok" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{tagImport.fileName}</p>
            <p className="text-xs text-text-muted">
              {tagImport.summary.total.toLocaleString()} tags detected
            </p>
          </div>
          <Badge tone="ok" dot>
            Parsed
          </Badge>
        </div>
      )}

      {tagImport && tagImport.corrections.length > 0 && (
        <Panel
          title={`${tagImport.corrections.length} names corrected`}
          leading={<TriangleAlert size={14} aria-hidden className="text-status-warn" />}
          collapsible
          defaultOpen={false}
          bordered
          flush
        >
          <ul className="max-h-48 divide-y divide-line-subtle overflow-y-auto border-t border-line-subtle text-xs">
            {tagImport.corrections.map((c) => (
              <li key={`${c.from}->${c.to}`} className="px-3 py-2">
                <p className="font-mono">
                  <span className="text-text-faint line-through">{c.from}</span>
                  <span aria-hidden className="px-1.5 text-text-muted">
                    →
                  </span>
                  <span className="text-text-primary">{c.to}</span>
                </p>
                <p className="text-text-muted">{c.reason}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tagImport && tagImport.skipped.length > 0 && (
        <Panel
          title={`${tagImport.skipped.length} rows skipped`}
          leading={<CircleAlert size={14} aria-hidden className="text-status-alarm" />}
          collapsible
          defaultOpen={false}
          bordered
          flush
        >
          <ul className="max-h-48 divide-y divide-line-subtle overflow-y-auto border-t border-line-subtle text-xs">
            {tagImport.skipped.map((s) => (
              <li key={`${s.row}-${s.value}`} className="px-3 py-2">
                <p className="font-mono text-text-secondary">
                  row {s.row}: {s.value || "(empty)"}
                </p>
                <p className="text-text-muted">{s.reason}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
