"use client";

/**
 * Whose colours the screens wear: the Standard's, or their own.
 *
 * The pack holds every face to neutral greys with colour only for alarms, and
 * validation warns on anything else - right for a site that runs ISA-101, and
 * wrong for screens drawn with care in colours of their own (the connector's
 * Claude draws good ones). This is the one switch between the two. It is a
 * project setting, so the app's validation and the connector's check_project
 * agree on it, and it changes no colour: going back to the Standard only
 * brings the warnings back, and "Apply the Standard" stays an explicit act.
 */

import { Palette, Ruler } from "lucide-react";
import { useProject } from "@/store/project";
import { useCanEdit } from "@/store/access";
import type { ColourMode } from "@/store/types";
import { cn } from "@/components/ui";

const MODES: { id: ColourMode; label: string; icon: typeof Ruler; title: string }[] = [
  { id: "standard", label: "Standard colours", icon: Ruler, title: "Neutral faces, colour only for alarms; colours outside the pack are warned about" },
  { id: "own", label: "Our own colours", icon: Palette, title: "Keep the colours the screens were drawn with; no colour warnings" },
];

export function ColourModeSwitch({ onChange, className }: { onChange?: (mode: ColourMode) => void; className?: string }) {
  const mode = useProject((s) => s.standards.colours ?? "standard");
  const setStandards = useProject((s) => s.setStandards);
  const canEdit = useCanEdit();

  return (
    <div role="radiogroup" aria-label="Colours" className={cn("inline-flex items-center gap-1 rounded-lg border border-line-subtle bg-surface-raised p-1", className)}>
      {MODES.map(({ id, label, icon: Icon, title }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          title={title}
          disabled={!canEdit}
          onClick={() => {
            if (mode === id) return;
            setStandards({ colours: id });
            onChange?.(id);
          }}
          className={cn(
            "focus-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition disabled:opacity-50",
            mode === id ? "bg-surface-active font-medium text-text-primary" : "text-text-muted hover:text-text-primary",
          )}
        >
          <Icon size={13} aria-hidden className={mode === id ? "text-brand-400" : undefined} />
          {label}
        </button>
      ))}
    </div>
  );
}
