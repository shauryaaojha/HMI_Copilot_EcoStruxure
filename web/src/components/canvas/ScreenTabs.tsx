"use client";

/**
 * The project's screens, as tabs.
 *
 * An HMI application is never one screen - ISA-101 puts a plant overview above
 * unit overviews above detail displays, and an operator reaches them through
 * navigation that is in the same place on every one. So screens are a first
 * class thing here: add, rename in place, duplicate, reorder by dragging, and
 * delete, with the last one protected because a project with no screen cannot
 * be packaged.
 *
 * Reordering matters beyond tidiness: the packager writes screen 0 as the one
 * the binding graph is anchored to, so "which screen is first" is a real
 * property of the export, not a display preference.
 */

import { useEffect, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useProject } from "@/store/project";
import { cn } from "@/components/ui";

export function ScreenTabs() {
  const screens = useProject((s) => s.screens);
  const activeScreenId = useProject((s) => s.activeScreenId);
  const setActiveScreen = useProject((s) => s.setActiveScreen);
  const addScreen = useProject((s) => s.addScreen);
  const duplicateScreen = useProject((s) => s.duplicateScreen);
  const renameScreen = useProject((s) => s.renameScreen);
  const removeScreen = useProject((s) => s.removeScreen);
  const reorderScreens = useProject((s) => s.reorderScreens);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const dragFrom = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const active = activeScreenId ?? screens[0]?.UniqueId;

  function commit() {
    if (editing) renameScreen(editing, draft);
    setEditing(null);
  }

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {screens.map((screen, index) => {
        const isActive = screen.UniqueId === active;
        const count = screen.Children[0].Children.length;
        return (
          <div
            key={screen.UniqueId}
            draggable={!editing}
            onDragStart={() => {
              dragFrom.current = index;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragFrom.current !== null) reorderScreens(dragFrom.current, index);
              dragFrom.current = null;
            }}
            className={cn(
              "group flex shrink-0 items-center gap-1 rounded-t-md border-b-2 px-2 py-1 text-xs transition",
              isActive
                ? "border-brand-400 bg-surface-raised text-text-primary"
                : "border-transparent text-text-muted hover:bg-surface-hover hover:text-text-secondary",
            )}
          >
            {editing === screen.UniqueId ? (
              <input
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(null);
                }}
                className="focus-ring w-28 rounded bg-surface-base px-1 py-0.5 text-xs"
                aria-label="Screen name"
              />
            ) : (
              <button
                type="button"
                onClick={() => setActiveScreen(screen.UniqueId)}
                onDoubleClick={() => {
                  setEditing(screen.UniqueId);
                  setDraft(screen.Name);
                }}
                title={`${screen.Name} — ${count} object${count === 1 ? "" : "s"}. Double-click to rename.`}
                className="focus-ring max-w-[12rem] truncate py-1.5 font-medium"
              >
                {screen.Name}
              </button>
            )}

            <span className="tabular-nums text-[10px] text-text-faint">{count}</span>

            {isActive && (
              <span className="flex items-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => duplicateScreen(screen.UniqueId)}
                  title="Duplicate this screen"
                  aria-label={`Duplicate ${screen.Name}`}
                  className="focus-ring flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-text-primary"
                >
                  <Copy size={12} aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={screens.length <= 1}
                  onClick={() => removeScreen(screen.UniqueId)}
                  title={
                    screens.length <= 1
                      ? "A project needs at least one screen"
                      : "Delete this screen"
                  }
                  aria-label={`Delete ${screen.Name}`}
                  className="focus-ring flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-status-alarm disabled:opacity-30"
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </span>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => addScreen()}
        title="Add a screen"
        aria-label="Add a screen"
        className="focus-ring ml-1 shrink-0 rounded p-1 text-text-muted transition hover:bg-surface-hover hover:text-text-primary"
      >
        <Plus size={14} aria-hidden />
      </button>
    </div>
  );
}
