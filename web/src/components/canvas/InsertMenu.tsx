"use client";

/**
 * Every part the packager can emit, in one menu, grouped the way an HMI
 * engineer thinks about them: what draws, what indicates, what the operator
 * touches, what displays a value, what shows data over time.
 *
 * The toolbar keeps five tools inline - the ones a hand reaches for on every
 * screen - and this menu holds the whole list. Fourteen icons in a row was a
 * wall the eye could not scan, and the toolbar already scrolls; a menu with
 * labels, hints and the key that arms each tool is what every design tool
 * does once its palette passes ten.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { PartType } from "@/lib/ote/schema";
import { cn } from "@/components/ui";
import { TOOLS, type ToolGroup } from "./newPart";
import { TOOL_ICON } from "./toolIcons";

const GROUPS: ToolGroup[] = ["Basic", "Indicators", "Controls", "Displays", "Data"];

export function InsertMenu({
  tool,
  onTool,
}: {
  tool: PartType | null;
  onTool: (tool: PartType | null) => void;
}) {
  const [open, setOpen] = useState(false);
  /**
   * Where the menu goes, in viewport pixels. The button lives inside the
   * toolbar's horizontal scroller, and a container that scrolls on one axis
   * clips on the other - so a menu positioned inside it would be cut off at
   * the toolbar's bottom edge. Fixed positioning takes it out of that box.
   */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = button.current?.getBoundingClientRect();
    if (rect) setAt({ left: rect.left, top: rect.bottom + 4 });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // A scroll or a resize moves the button out from under a fixed menu -
    // unless it is the menu's own list scrolling, which is fine.
    const close = () => setOpen(false);
    const scrolled = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Insert an object"
        className={cn(
          "focus-ring flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
          open
            ? "bg-surface-active text-text-primary"
            : "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
        )}
      >
        <Plus size={13} aria-hidden />
        Insert
        <ChevronDown size={11} aria-hidden className="text-text-faint" />
      </button>

      {open && at && (
        <div
          role="menu"
          aria-label="Insert an object"
          className="fixed z-30 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-line bg-surface-float p-1.5"
          style={{ left: at.left, top: at.top, boxShadow: "var(--elev-3)" }}
        >
          {GROUPS.map((group) => {
            const members = TOOLS.filter((t) => t.group === group);
            if (members.length === 0) return null;
            return (
              <div key={group} className="py-1">
                <p className="label-eyebrow px-2 pb-1">{group}</p>
                {members.map((t) => {
                  const Icon = TOOL_ICON[t.type];
                  const armed = tool === t.type;
                  return (
                    <button
                      key={t.type}
                      type="button"
                      role="menuitemradio"
                      aria-checked={armed}
                      onClick={() => {
                        onTool(armed ? null : t.type);
                        setOpen(false);
                      }}
                      className={cn(
                        "focus-ring flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition",
                        armed
                          ? "bg-brand-500/15 text-text-primary"
                          : "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                          armed ? "bg-brand-500/20 text-brand-400" : "bg-surface-raised text-text-muted",
                        )}
                      >
                        <Icon size={13} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium">{t.label}</span>
                        <span className="block truncate text-[10px] text-text-faint">{t.hint}</span>
                      </span>
                      <kbd className="rounded border border-line-subtle px-1 font-mono text-[10px] uppercase text-text-faint">
                        {t.key}
                      </kbd>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
