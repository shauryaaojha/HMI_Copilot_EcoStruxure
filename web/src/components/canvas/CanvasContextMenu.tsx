"use client";

/**
 * Right-click on the canvas.
 *
 * Nothing here is unique to the menu - every entry is the same store action the
 * toolbar and the keyboard reach, which is what stops the three from drifting.
 * It closes on any pointer down outside it, on Escape, and on scroll, because a
 * menu that survives the thing it was about is worse than no menu.
 */

import { useEffect, useRef } from "react";
import { useProject } from "@/store/project";
import { cn } from "@/components/ui";

export interface ContextTarget {
  x: number;
  y: number;
  objectId?: string;
}

interface Entry {
  label: string;
  shortcut?: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function CanvasContextMenu({
  at,
  onClose,
}: {
  at: ContextTarget;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const selectedIds = useProject((s) => s.selectedIds);
  const objectMeta = useProject((s) => s.objectMeta);
  const clipboard = useProject((s) => s.clipboard);

  const copyObjects = useProject((s) => s.copyObjects);
  const cutObjects = useProject((s) => s.cutObjects);
  const pasteObjects = useProject((s) => s.pasteObjects);
  const duplicateObjects = useProject((s) => s.duplicateObjects);
  const removeObjects = useProject((s) => s.removeObjects);
  const restackObjects = useProject((s) => s.restackObjects);
  const group = useProject((s) => s.group);
  const ungroup = useProject((s) => s.ungroup);
  const setMeta = useProject((s) => s.setMeta);
  const selectAll = useProject((s) => s.selectAll);

  useEffect(() => {
    const close = (event: Event) => {
      if (event.type === "pointerdown" && menu.current?.contains(event.target as Node)) {
        return;
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("wheel", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const some = selectedIds.length > 0;
  const anyLocked = selectedIds.some((id) => objectMeta[id]?.locked);
  const anyGrouped = selectedIds.some((id) => objectMeta[id]?.groupId);

  const groups: Entry[][] = [
    [
      { label: "Cut", shortcut: "Ctrl+X", run: () => cutObjects(selectedIds), disabled: !some },
      { label: "Copy", shortcut: "Ctrl+C", run: () => copyObjects(selectedIds), disabled: !some },
      { label: "Paste", shortcut: "Ctrl+V", run: pasteObjects, disabled: clipboard.length === 0 },
      {
        label: "Duplicate",
        shortcut: "Ctrl+D",
        run: () => duplicateObjects(selectedIds),
        disabled: !some,
      },
    ],
    [
      { label: "Bring to front", shortcut: "]", run: () => restackObjects(selectedIds, "front"), disabled: !some },
      { label: "Bring forward", run: () => restackObjects(selectedIds, "forward"), disabled: !some },
      { label: "Send backward", run: () => restackObjects(selectedIds, "backward"), disabled: !some },
      { label: "Send to back", shortcut: "[", run: () => restackObjects(selectedIds, "back"), disabled: !some },
    ],
    [
      { label: "Group", shortcut: "Ctrl+G", run: () => group(selectedIds), disabled: selectedIds.length < 2 },
      { label: "Ungroup", run: () => ungroup(selectedIds), disabled: !anyGrouped },
      {
        label: anyLocked ? "Unlock" : "Lock",
        run: () => setMeta(selectedIds, { locked: !anyLocked }),
        disabled: !some,
      },
      { label: "Hide", run: () => setMeta(selectedIds, { hidden: true }), disabled: !some },
    ],
    [
      { label: "Select all", shortcut: "Ctrl+A", run: selectAll },
      {
        label: "Delete",
        shortcut: "Del",
        run: () => removeObjects(selectedIds),
        disabled: !some,
        danger: true,
      },
    ],
  ];

  return (
    <div
      ref={menu}
      role="menu"
      // Fixed to the viewport because the canvas scrolls under it, and clamped
      // so a right-click near the bottom edge does not open off-screen.
      style={{
        left: Math.min(at.x, (globalThis.innerWidth ?? 1200) - 210),
        top: Math.min(at.y, (globalThis.innerHeight ?? 800) - 380),
      }}
      className="fixed z-50 w-52 rounded-md border border-line bg-surface-raised py-1 shadow-lg"
    >
      {groups.map((entries, i) => (
        <div key={i} className={cn(i > 0 && "mt-1 border-t border-line-subtle pt-1")}>
          {entries.map((entry) => (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              disabled={entry.disabled}
              onClick={() => {
                entry.run();
                onClose();
              }}
              className={cn(
                "flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs transition",
                "disabled:pointer-events-none disabled:opacity-35",
                entry.danger
                  ? "text-status-alarm hover:bg-status-alarm/10"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
              )}
            >
              {entry.label}
              {entry.shortcut && (
                <span className="text-[10px] tabular-nums text-text-faint">
                  {entry.shortcut}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
