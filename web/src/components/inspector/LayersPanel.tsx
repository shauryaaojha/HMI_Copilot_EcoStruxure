"use client";

/**
 * The objects on this screen, in paint order.
 *
 * The list *is* the z-order: ViewBox.Children is what the packager writes and
 * what the product paints, so dragging a row here is not a display preference,
 * it changes the file. Top of the list is the front of the screen, the way
 * every layers panel reads, which means the list is the array reversed.
 *
 * Lock and hide live in ObjectMeta beside the parts rather than inside them -
 * Screen.dat has no field for either, and inventing one would put a property in
 * the export that the product would not recognise.
 */

import { useRef, useState } from "react";
import {
  Bell,
  Eye,
  EyeOff,
  Hash,
  Lightbulb,
  Lock,
  Route,
  Square,
  Type,
  Unlock,
} from "lucide-react";
import type { PartType } from "@/lib/ote/schema";
import { useProject } from "@/store/project";
import { cn } from "@/components/ui";

const ICON: Record<PartType, typeof Square> = {
  Rectangle: Square,
  TextBox: Type,
  Lamp: Lightbulb,
  NumericDisplay: Hash,
  AlarmSummary: Bell,
  Path: Route,
};

export function LayersPanel() {
  const screens = useProject((s) => s.screens);
  const activeScreenId = useProject((s) => s.activeScreenId);
  const selectedIds = useProject((s) => s.selectedIds);
  const objectMeta = useProject((s) => s.objectMeta);
  const bindings = useProject((s) => s.bindings);
  const select = useProject((s) => s.select);
  const hover = useProject((s) => s.hover);
  const setMeta = useProject((s) => s.setMeta);
  const restackObjects = useProject((s) => s.restackObjects);

  const [dragging, setDragging] = useState<string | null>(null);
  const from = useRef<number | null>(null);

  const screen = screens.find((x) => x.UniqueId === activeScreenId) ?? screens[0];
  if (!screen) {
    return (
      <p className="p-4 text-sm text-text-muted">
        No screen yet. Describe what you need and the objects will appear here.
      </p>
    );
  }

  const parts = screen.Children[0].Children;
  const bound = new Set(bindings.map((b) => b.targetId));
  const selected = new Set(selectedIds);
  // Front-to-back, because that is how a layers panel reads.
  const rows = [...parts].reverse();

  /**
   * Dragging is expressed as repeated single steps rather than as a splice,
   * so it goes through the same restack() the toolbar and the keyboard use -
   * one implementation of "what does forward mean", tested once.
   */
  function drop(toRow: number) {
    if (from.current === null || from.current === toRow) return;
    const id = rows[from.current].UniqueId;
    const steps = Math.abs(toRow - from.current);
    const move = toRow < from.current ? "forward" : "backward";
    for (let i = 0; i < steps; i++) restackObjects([id], move);
    from.current = null;
    setDragging(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-3 pb-1 pt-3 text-[10px] uppercase tracking-wide text-text-faint">
        {screen.Name} · {parts.length} object{parts.length === 1 ? "" : "s"} · front to back
      </p>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {rows.map((part, row) => {
          const meta = objectMeta[part.UniqueId] ?? {};
          const Icon = ICON[part.Type] ?? Square;
          const isSelected = selected.has(part.UniqueId);
          return (
            <li key={part.UniqueId}>
              <div
                draggable
                onDragStart={() => {
                  from.current = row;
                  setDragging(part.UniqueId);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => drop(row)}
                onDragEnd={() => {
                  from.current = null;
                  setDragging(null);
                }}
                onPointerEnter={() => hover(part.UniqueId)}
                onPointerLeave={() => hover(undefined)}
                className={cn(
                  "group flex items-center gap-1.5 rounded px-1.5 py-1 transition",
                  isSelected
                    ? "bg-brand-500/12 text-text-primary"
                    : "text-text-secondary hover:bg-surface-hover",
                  dragging === part.UniqueId && "opacity-40",
                  meta.hidden && "opacity-50",
                )}
              >
                <Icon size={12} aria-hidden className="shrink-0 text-text-faint" />

                <button
                  type="button"
                  onClick={(e) => select([part.UniqueId], e.shiftKey)}
                  className="focus-ring min-w-0 flex-1 truncate text-left text-[11px]"
                  title={`${part.Name} — ${part.Type} at ${part.Location.Left}, ${part.Location.Top}`}
                >
                  {part.Name}
                </button>

                {bound.has(part.UniqueId) && (
                  <span
                    aria-label="bound to a tag"
                    title="Bound to a tag"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"
                  />
                )}
                {meta.groupId && (
                  <span
                    aria-label="grouped"
                    title="Part of a group"
                    className="shrink-0 text-[9px] text-text-faint"
                  >
                    G
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => setMeta([part.UniqueId], { hidden: !meta.hidden })}
                  title={meta.hidden ? "Show" : "Hide"}
                  aria-label={meta.hidden ? `Show ${part.Name}` : `Hide ${part.Name}`}
                  className={cn(
                    "focus-ring shrink-0 rounded p-0.5 text-text-faint hover:text-text-primary",
                    !meta.hidden && "opacity-0 group-hover:opacity-100 focus:opacity-100",
                  )}
                >
                  {meta.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
                <button
                  type="button"
                  onClick={() => setMeta([part.UniqueId], { locked: !meta.locked })}
                  title={meta.locked ? "Unlock" : "Lock"}
                  aria-label={meta.locked ? `Unlock ${part.Name}` : `Lock ${part.Name}`}
                  className={cn(
                    "focus-ring shrink-0 rounded p-0.5 text-text-faint hover:text-text-primary",
                    !meta.locked && "opacity-0 group-hover:opacity-100 focus:opacity-100",
                  )}
                >
                  {meta.locked ? <Lock size={11} /> : <Unlock size={11} />}
                </button>
              </div>
            </li>
          );
        })}

        {parts.length === 0 && (
          <li className="rounded-md border border-dashed border-line p-6 text-center text-xs text-text-muted">
            This screen is empty. Draw something, or ask for it in the chat.
          </li>
        )}
      </ul>
    </div>
  );
}
