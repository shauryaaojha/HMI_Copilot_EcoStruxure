"use client";

/**
 * The app frame's top edge. Deliberately the quietest thing on screen.
 *
 * It used to be 56px carrying the product name, a tagline, the project name, a
 * save stamp, a target-panel dropdown, a mismatch warning, a theme toggle and
 * an Export button - permanently, on every route. Most of that is touched once
 * a session, and all of it competed with the canvas for attention.
 *
 * What survives is what changes while you work: which project this is, whether
 * it saved, and what the export will actually target. Everything else moved
 * into the command palette, reachable by name on Ctrl+K - which is how a modern
 * tool holds infrequent things without spending a bar on them.
 *
 * The frame uses surface-frame, a step darker than any pane, so the chrome
 * recedes and the work sits on top of it rather than beside it.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Command, Download, Monitor, Pencil, SquarePen } from "lucide-react";
import { useProject } from "@/store/project";
import { Input, cn } from "@/components/ui";
import { SchneiderMark } from "./SchneiderMark";
import { useNewProject } from "./useNewProject";
import { CommandPalette, useCommandPalette } from "./CommandPalette";

interface Panel {
  model: string;
  width: number;
  height: number;
}

/** What the skeleton's Target.dat says. Null until known, or if unconfigured. */
function useActualPanel(): Panel | null {
  const [panel, setPanel] = useState<Panel | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/panel")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (live && body?.panel) setPanel(body.panel as Panel);
      })
      .catch(() => {
        // No skeleton, or the route is unreachable. The header simply does not
        // claim a panel it cannot confirm.
      });
    return () => {
      live = false;
    };
  }, []);

  return panel;
}

/** "2 min ago". Client-only, so the server and the client cannot disagree. */
function useSavedLabel(savedAt: number | undefined) {
  const [label, setLabel] = useState<string>();

  useEffect(() => {
    if (savedAt === undefined) {
      setLabel(undefined);
      return;
    }
    const render = () => {
      const secs = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
      if (secs < 45) return setLabel("saved");
      const mins = Math.round(secs / 60);
      if (mins < 60) return setLabel(`saved ${mins}m ago`);
      const hours = Math.round(mins / 60);
      return setLabel(`saved ${hours}h ago`);
    };
    render();
    const timer = setInterval(render, 15_000);
    return () => clearInterval(timer);
  }, [savedAt]);

  return label;
}

function ProjectNameField() {
  const name = useProject((s) => s.name);
  const rename = useProject((s) => s.rename);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function commit() {
    const next = draft.trim();
    if (next) rename(next);
    else setDraft(name);
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        ref={input}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        className="h-7 w-52"
        aria-label="Project name"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      title="Rename project"
      className="focus-ring group flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-text-primary transition hover:bg-surface-hover"
    >
      <span className="truncate">{name}</span>
      <Pencil
        size={11}
        aria-hidden
        className="shrink-0 text-transparent transition group-hover:text-text-faint"
      />
    </button>
  );
}

export interface TopBarProps {
  onExport?: () => void;
  className?: string;
}

export function TopBar({ onExport, className }: TopBarProps) {
  const projectId = useProject((s) => s.id);
  const target = useProject((s) => s.target);
  const actual = useActualPanel();
  const savedAt = useProject((s) => s.savedAt);
  const saved = useSavedLabel(savedAt);
  const newProject = useNewProject();
  const palette = useCommandPalette();

  // The label has to be the file's, not the dropdown's. Saying HMIGTO6310 over
  // a project whose Target.dat reads HMIST6500AWADI is exactly the kind of
  // small untruth "the preview cannot lie" cannot afford.
  const mismatch =
    actual !== null &&
    (actual.width !== target.width ||
      actual.height !== target.height ||
      actual.model !== target.model);

  return (
    <>
      <header
        className={cn(
          "flex h-11 shrink-0 items-center gap-1 border-b border-line-subtle bg-surface-frame px-2",
          className,
        )}
      >
        <Link
          href="/"
          title="HMI Copilot"
          className="focus-ring flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-surface-hover"
        >
          <SchneiderMark className="text-brand-400" />
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            Copilot
          </span>
        </Link>

        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-subtle" />

        <button
          type="button"
          onClick={() => newProject()}
          title="New project — blank canvas, empty conversation"
          aria-label="New project"
          className="focus-ring shrink-0 rounded-md p-1.5 text-text-muted transition hover:bg-surface-hover hover:text-text-primary"
        >
          <SquarePen size={15} aria-hidden />
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <ProjectNameField />
          {saved && (
            <span className="hidden shrink-0 items-center gap-1 text-[11px] text-text-faint lg:flex">
              <Check size={11} aria-hidden className="text-brand-400" />
              {saved}
            </span>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* The panel the file will target. A read-out, not a control - the
              control is in the palette, because it is set once. */}
          <button
            type="button"
            onClick={() => palette.setOpen(true)}
            title={
              mismatch
                ? `The exported file targets ${actual!.model} ${actual!.width}×${actual!.height} — its Target.dat, which the app cannot change.`
                : "Change the target panel"
            }
            className={cn(
              "focus-ring hidden items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition md:flex",
              mismatch
                ? "border-status-warn/50 text-status-warn"
                : "border-line-subtle text-text-muted hover:border-line hover:text-text-secondary",
            )}
          >
            <Monitor size={12} aria-hidden />
            <span className="text-figure">
              {target.width} × {target.height}
            </span>
            {mismatch && <span className="font-medium">≠ file</span>}
          </button>

          <button
            type="button"
            onClick={() => palette.setOpen(true)}
            title="Commands (Ctrl+K)"
            className="focus-ring flex items-center gap-1.5 rounded-md border border-line-subtle px-2 py-1 text-[11px] text-text-muted transition hover:border-line hover:text-text-secondary"
          >
            <Command size={12} aria-hidden />
            <span className="hidden sm:inline">K</span>
          </button>

          {onExport ? (
            <button
              type="button"
              onClick={onExport}
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md bg-brand-500 px-3 text-xs font-medium text-text-onbrand transition hover:bg-brand-600"
              style={{ boxShadow: "var(--elev-1)" }}
            >
              <Download size={14} aria-hidden />
              Export
            </button>
          ) : (
            <Link
              href={`/project/${projectId}/export`}
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md bg-brand-500 px-3 text-xs font-medium text-text-onbrand transition hover:bg-brand-600"
              style={{ boxShadow: "var(--elev-1)" }}
            >
              <Download size={14} aria-hidden />
              Export
            </Link>
          )}
        </div>
      </header>

      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
    </>
  );
}
