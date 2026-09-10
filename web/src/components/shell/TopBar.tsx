"use client";

/**
 * Product identity, project name, target panel, theme and Export.
 * Reference screens 1-6.
 *
 * Everything here except the product name comes out of the store. A component
 * that hardcodes a project's name cannot show a second project, which is the
 * Phase 0 exit criterion in docs/BUILD_PLAN.md.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Download, Monitor, Pencil } from "lucide-react";
import { useProject } from "@/store/project";
import { Button, Input, Select, cn } from "@/components/ui";
import { SchneiderMark } from "./SchneiderMark";
import { ThemeToggle } from "./theme";

/**
 * Panels the layout can target.
 *
 * The exported file's panel is not one of these - it comes from Target.dat
 * inside the extracted skeleton, which the app cannot change. Choosing one here
 * sets what the layout is designed for; useActualPanel() below asks the server
 * what the file will actually say, and the header flags a disagreement rather
 * than showing a label the .eote contradicts.
 */
const TARGETS = [
  { value: "HMIGTO6310|1024|768", label: "HMIGTO6310 · 1024 × 768" },
  { value: "HMIGTO5310|800|480", label: "HMIGTO5310 · 800 × 480" },
  { value: "HMIGTO4310|640|480", label: "HMIGTO4310 · 640 × 480" },
  { value: "HMISTU855|320|240", label: "HMISTU855 · 320 × 240" },
];

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
      if (secs < 45) return setLabel("just now");
      const mins = Math.round(secs / 60);
      if (mins < 60) return setLabel(`${mins} min ago`);
      const hours = Math.round(mins / 60);
      return setLabel(`${hours} ${hours === 1 ? "hour" : "hours"} ago`);
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
        className="h-8 w-56"
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
      className="focus-ring group flex h-8 items-center gap-2 rounded-md border border-line bg-surface-raised px-3 text-sm font-medium text-text-primary transition hover:border-line-strong"
    >
      {name}
      <Pencil
        size={13}
        aria-hidden
        className="text-text-faint transition group-hover:text-text-secondary"
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
  const setTarget = useProject((s) => s.setTarget);
  const saved = useSavedLabel(savedAt);

  const value = `${target.model}|${target.width}|${target.height}`;

  // The label has to be the file's, not the dropdown's. Saying HMIGTO6310
  // over a project whose Target.dat reads HMIST6500AWADI is exactly the kind
  // of small untruth "the preview cannot lie" cannot afford.
  const actualLabel = actual
    ? `${actual.model} · ${actual.width} × ${actual.height}`
    : null;
  const mismatch =
    actual !== null &&
    (actual.width !== target.width ||
      actual.height !== target.height ||
      actual.model !== target.model);
  const known = TARGETS.some((t) => t.value === value);

  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-3 border-b border-line-subtle bg-surface-panel px-4",
        className,
      )}
    >
      <SchneiderMark className="hidden shrink-0 text-text-primary sm:block" />
      <span aria-hidden className="hidden h-6 w-px bg-line sm:block" />
      <span className="shrink-0 text-lg font-semibold tracking-tight">HMI Copilot</span>
      <span aria-hidden className="hidden h-6 w-px bg-line xl:block" />
      <span className="hidden shrink-0 text-sm text-text-muted xl:inline">
        From Intent to HMI — Faster. Smarter. Safer.
      </span>

      <div className="ml-4 flex min-w-0 items-center gap-3">
        <ProjectNameField />
        {saved && (
          <span className="hidden shrink-0 items-center gap-1.5 text-xs text-text-muted lg:flex">
            <Check size={13} aria-hidden className="text-brand-400" />
            Saved {saved}
          </span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div
          className={cn(
            "hidden items-center gap-2 rounded-md border bg-surface-raised pl-2.5 md:flex",
            mismatch ? "border-status-warn" : "border-line",
          )}
          title={
            mismatch
              ? `The exported file targets ${actualLabel} — its Target.dat, which the app cannot change.`
              : actual
                ? `Matches the file's Target.dat (${actualLabel}).`
                : undefined
          }
        >
          <Monitor
            size={15}
            aria-hidden
            className={mismatch ? "text-status-warn" : "text-text-muted"}
          />
          <Select
            aria-label="Target panel"
            size="sm"
            className="w-52 border-0 bg-transparent"
            value={known ? value : TARGETS[0].value}
            options={TARGETS}
            onChange={(e) => {
              const [model, w, h] = e.target.value.split("|");
              setTarget({ model, width: Number(w), height: Number(h) });
            }}
          />
        </div>

        {mismatch && (
          <span className="hidden text-xs text-status-warn lg:inline" role="status">
            file targets {actualLabel}
          </span>
        )}

        <ThemeToggle />

        {onExport ? (
          <Button variant="primary" icon={<Download size={16} />} onClick={onExport}>
            Export
          </Button>
        ) : (
          <Link
            href={`/project/${projectId}/export`}
            className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-brand-500 px-3.5 text-sm font-medium text-text-onbrand shadow-sm transition hover:bg-brand-600"
          >
            <Download size={16} aria-hidden />
            Export
          </Link>
        )}
      </div>
    </header>
  );
}
