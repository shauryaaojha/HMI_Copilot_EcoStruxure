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

import { useParams } from "next/navigation";
import { AccountControl } from "./AccountControl";
import { PresenceAvatars } from "@/components/collab/PresenceAvatars";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Command, Download, Monitor, Pencil, SquarePen, Users } from "lucide-react";
import { useProject } from "@/store/project";
import { useAccess, useCanEdit } from "@/store/access";
import { ShareDialog } from "./ShareDialog";
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

function ProjectNameField() {
  const name = useProject((s) => s.name);
  const rename = useProject((s) => s.rename);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  // Renaming is an edit like any other: a read-only project shows its name.
  const canEdit = useCanEdit();

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (!canEdit) {
    return (
      <span className="flex h-7 min-w-0 items-center px-1.5 text-sm font-semibold text-text-primary">
        <span className="truncate">{name}</span>
      </span>
    );
  }

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
      className="focus-ring group flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm font-semibold text-text-primary transition hover:bg-surface-hover"
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
  // From the route: the store's id is empty until the project has loaded.
  const storeId = useProject((s) => s.id);
  const projectId = useParams<{ id?: string }>()?.id ?? storeId;
  const target = useProject((s) => s.target);
  const actual = useActualPanel();
  const newProject = useNewProject();
  const palette = useCommandPalette();
  // Sharing exists only for a project with a server copy: a browser-only
  // project has nobody to share it through.
  const cloud = useAccess((s) => s.access !== null && s.projectId === projectId);
  const [sharing, setSharing] = useState(false);

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
          "flex h-12 shrink-0 items-center gap-1 bg-surface-frame px-2",
          className,
        )}
      >
        <Link
          href="/projects"
          title="Your projects"
          className="focus-ring flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-surface-hover"
        >
          <SchneiderMark className="text-brand-400" />
          <span className="hidden items-baseline gap-1 text-sm font-semibold tracking-tight sm:flex">
            HMI <span className="text-brand-400">Copilot</span>
          </span>
        </Link>

        <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line" />

        <button
          type="button"
          onClick={() => newProject()}
          title="New project — blank canvas, empty conversation"
          aria-label="New project"
          className="focus-ring shrink-0 rounded-lg p-1.5 text-text-muted transition hover:bg-surface-hover hover:text-text-primary"
        >
          <SquarePen size={15} aria-hidden />
        </button>

        {/* Where you are: the projects, then this one. */}
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5 text-sm">
          <Link href="/projects" className="focus-ring hidden shrink-0 rounded-md px-1.5 py-1 text-text-muted transition hover:text-text-primary md:inline">
            Projects
          </Link>
          <ChevronRight size={13} aria-hidden className="hidden shrink-0 text-text-faint md:block" />
          <ProjectNameField />
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Who else is in this shared project right now (Phase C). */}
          <PresenceAvatars />
          <AccountControl projectId={projectId} />
          {cloud && (
            <button
              type="button"
              onClick={() => setSharing(true)}
              title="Share this project: members, roles and links"
              className="chip focus-ring"
            >
              <Users size={12} aria-hidden />
              Share
            </button>
          )}
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
              "chip focus-ring hidden md:inline-flex",
              mismatch && "!border-status-warn/50 !text-status-warn",
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
            className="chip focus-ring"
          >
            <Command size={12} aria-hidden />
            <span className="hidden sm:inline">K</span>
          </button>

          {onExport ? (
            <button
              type="button"
              onClick={onExport}
              className="btn-primary focus-ring press ml-0.5 inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold text-text-onbrand transition hover:brightness-110"
            >
              <Download size={14} aria-hidden />
              Export
            </button>
          ) : (
            <Link
              href={`/project/${projectId}/export`}
              className="btn-primary focus-ring press ml-0.5 inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold text-text-onbrand transition hover:brightness-110"
            >
              <Download size={14} aria-hidden />
              Export
            </Link>
          )}
        </div>
      </header>

      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
      {sharing && cloud && <ShareDialog projectId={projectId} onClose={() => setSharing(false)} />}
    </>
  );
}
