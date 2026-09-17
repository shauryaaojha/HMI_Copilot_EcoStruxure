"use client";

/**
 * Pick which of another project's screens to bring into this one.
 *
 * The file goes to /api/import/screens, which models it and keeps nothing.
 * Each screen is listed with what it holds and what will not come (objects
 * of a type the editor does not model stay in the file they came from). On
 * import the store re-points every binding by tag name, adds the tags this
 * project lacks, and reports what it dropped - so the engineer reads the
 * outcome before the dialog closes, rather than discovering an unbound lamp
 * on site. docs/PLAN_PHASE2.md item 2.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import type { Screen, Variable } from "@/lib/ote/schema";
import type { Binding, ForeignPart, ImportReport } from "@/store/types";
import { useProject } from "@/store/project";
import { Button, cn } from "@/components/ui";

interface Read {
  name: string;
  screens: Screen[];
  foreign: Record<string, ForeignPart[]>;
  variables: Variable[];
  bindings: Binding[];
  warnings: string[];
}

export function ImportScreensDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const importScreens = useProject((s) => s.importScreens);
  const [read, setRead] = useState<Read | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<ImportReport | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const response = await fetch("/api/import/screens", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
          },
          body: await file.arrayBuffer(),
        });
        const data = (await response.json()) as Read & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `import failed (${response.status})`);
        if (!live) return;
        setRead(data);
        setPicked(new Set(data.screens.map((s) => s.UniqueId)));
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : "could not read that file");
      }
    })();
    return () => {
      live = false;
    };
  }, [file]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  function run() {
    if (!read) return;
    const screens = read.screens.filter((s) => picked.has(s.UniqueId));
    const ids = new Set(screens.flatMap((s) => s.Children[0].Children.map((p) => p.UniqueId)));
    setReport(
      importScreens({
        screens,
        variables: read.variables,
        bindings: read.bindings.filter((b) => ids.has(b.targetId)),
        foreign: read.foreign,
      }),
    );
  }

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Import screens"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface-float"
        style={{ boxShadow: "var(--elev-3)" }}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {report ? "Imported" : "Import screens"}
            <span className="ml-2 font-normal text-text-muted">{file.name}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring rounded-md p-1 text-text-muted transition hover:bg-surface-hover hover:text-text-primary"
          >
            <X size={14} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="flex gap-2 rounded-lg border border-status-alarm/40 bg-status-alarm/10 p-3 text-xs text-status-alarm">
              <AlertTriangle size={14} aria-hidden className="shrink-0" />
              {error}
            </p>
          ) : report ? (
            <div className="space-y-3 text-xs">
              <ul className="space-y-1 text-text-secondary">
                <li className="flex gap-2">
                  <Check size={12} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
                  {report.screens} {report.screens === 1 ? "screen" : "screens"}, {report.objects} objects
                </li>
                <li className="flex gap-2">
                  <Check size={12} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
                  {report.bindings} bindings re-pointed, {report.tagsAdded} tags added to this project
                </li>
                {report.renamed.map((line) => (
                  <li key={line} className="flex gap-2 text-text-muted">
                    <Check size={12} aria-hidden className="mt-0.5 shrink-0 text-text-faint" />
                    Renamed {line} to stay unique
                  </li>
                ))}
              </ul>
              {(report.droppedBindings.length > 0 || report.carriedLeftBehind > 0) && (
                <ul className="space-y-1 rounded-lg border border-status-warn/30 bg-status-warn/[0.06] p-2.5 text-status-warn">
                  {report.droppedBindings.map((line) => (
                    <li key={line} className="flex gap-2">
                      <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" />
                      Binding dropped: {line} - neither project has that tag
                    </li>
                  ))}
                  {report.carriedLeftBehind > 0 && (
                    <li className="flex gap-2">
                      <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" />
                      {report.carriedLeftBehind} carried{" "}
                      {report.carriedLeftBehind === 1 ? "object" : "objects"} of types this editor does
                      not model stayed in the source file
                    </li>
                  )}
                </ul>
              )}
              <p className="text-text-faint">Ctrl+Z undoes the whole import.</p>
            </div>
          ) : !read ? (
            <p className="is-thinking text-xs font-medium">Reading {file.name}&hellip;</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-text-muted">
                {read.name} has {read.screens.length} {read.screens.length === 1 ? "screen" : "screens"}{" "}
                and {read.variables.length} tags. Pick what to bring across.
              </p>
              <ul className="space-y-1">
                {read.screens.map((screen) => {
                  const count = screen.Children[0].Children.length;
                  const carried = read.foreign[screen.UniqueId]?.length ?? 0;
                  const on = picked.has(screen.UniqueId);
                  return (
                    <li key={screen.UniqueId}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition",
                          on
                            ? "border-brand-500/40 bg-brand-500/[0.06]"
                            : "border-line-subtle hover:border-line",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(screen.UniqueId)}
                          className="accent-[var(--color-brand-500)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-text-primary">
                            {screen.Name}
                          </span>
                          <span className="block text-[11px] text-text-muted">
                            {count} {count === 1 ? "object" : "objects"}
                            {carried > 0 && (
                              <span className="text-status-warn">
                                {" "}
                                · {carried} carried, will not come
                              </span>
                            )}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {read.warnings.length > 0 && (
                <ul className="space-y-1 text-[11px] text-status-warn">
                  {read.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <footer className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line-subtle px-4">
          {report || error ? (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!read || picked.size === 0} onClick={run}>
                Import {picked.size > 0 ? `${picked.size} ${picked.size === 1 ? "screen" : "screens"}` : ""}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
