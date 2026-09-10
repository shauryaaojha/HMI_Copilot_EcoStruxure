"use client";

/**
 * The project's screens, as a strip under the toolbar.
 *
 * It used to be a row of tabs and it was the only way to reach a screen, which
 * meant it was carrying two jobs: switching, and managing. The board does the
 * switching now - every screen is visible, clicking one makes it live - so this
 * is left with the managing: add, rename in place, duplicate, reorder by
 * dragging, delete.
 *
 * That is also why it looks different from the toolbar above it. They sat
 * adjacent at the same weight and read as one confused two-storey control bar;
 * the toolbar acts on objects, this acts on screens, and they are now visibly
 * different kinds of thing.
 *
 * Order is not cosmetic: the packager writes screen 0 as the one the binding
 * graph is anchored to, and the board reads left to right in this order.
 */

import { useEffect, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useProject } from "@/store/project";
import { cn } from "@/components/ui";

export function ScreenStrip() {
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
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line-subtle bg-surface-panel px-2">
      <span className="label-eyebrow shrink-0 pr-1">Screens</span>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
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
                "group flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] transition",
                isActive
                  ? "border-brand-500/50 bg-brand-500/12 text-brand-400"
                  : "border-line-subtle text-text-muted hover:border-line hover:text-text-secondary",
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
                  className="focus-ring w-28 rounded bg-surface-base px-1 text-[11px]"
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
                  title={`${screen.Name} - ${count} object${count === 1 ? "" : "s"}. Double-click to rename.`}
                  className="focus-ring max-w-[11rem] truncate font-medium"
                >
                  {screen.Name}
                </button>
              )}

              <span className="text-figure shrink-0 text-[9px] opacity-60">{count}</span>

              {isActive && (
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => duplicateScreen(screen.UniqueId)}
                    title="Duplicate this screen"
                    aria-label={`Duplicate ${screen.Name}`}
                    className="focus-ring rounded p-1 text-current opacity-50 transition hover:bg-surface-hover hover:opacity-100"
                  >
                    <Copy size={11} aria-hidden />
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
                    className="focus-ring rounded p-1 text-current opacity-50 transition hover:bg-status-alarm/15 hover:text-status-alarm hover:opacity-100 disabled:opacity-20"
                  >
                    <Trash2 size={11} aria-hidden />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => addScreen()}
        title="Add a screen"
        aria-label="Add a screen"
        className="focus-ring flex h-6 shrink-0 items-center gap-1 rounded-full border border-line-subtle px-2 text-[11px] text-text-muted transition hover:border-brand-500/50 hover:text-brand-400"
      >
        <Plus size={12} aria-hidden />
        Screen
      </button>
    </div>
  );
}
