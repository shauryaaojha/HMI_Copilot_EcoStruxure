"use client";

/**
 * Everything the top bar used to hold, one keystroke away.
 *
 * The bar carried a target-panel dropdown, a theme toggle, an export button and
 * a project name field, permanently, on every route. Most of them are touched
 * once a session. A command palette is how a modern tool holds infrequent
 * things: they stay reachable by name, and the frame gets its height back.
 *
 * Ctrl/Cmd+K opens it. Typing filters on the action and its keywords, so
 * "800" finds the 800x480 panel and "dark" finds the theme.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Download,
  FolderOpen,
  History,
  Library,
  Monitor,
  Moon,
  Ruler,
  Search,
  ShieldCheck,
  SquarePen,
  Sun,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { useProject } from "@/store/project";
import { cn } from "@/components/ui";
import { useTheme } from "./theme";
import { useNewProject } from "./useNewProject";
import { TARGETS } from "./targets";

interface Command {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon: LucideIcon;
  group: string;
  run: () => void;
  /** Shown as a tick, for a command that reports a current state. */
  active?: boolean;
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const projectId = useProject((s) => s.id);
  const target = useProject((s) => s.target);
  const setTarget = useProject((s) => s.setTarget);
  const standards = useProject((s) => s.standards);
  const setStandards = useProject((s) => s.setStandards);
  const { theme, setTheme } = useTheme();
  const newProject = useNewProject();

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // The input mounts with the dialog, so focus has to wait a frame.
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (slug: string) => () => {
      router.push(slug ? `/project/${projectId}/${slug}` : `/project/${projectId}`);
      onClose();
    };

    return [
      { id: "new", label: "New project", hint: "blank canvas", icon: SquarePen, group: "Project", keywords: "start fresh blank", run: () => { newProject(); onClose(); } },
      { id: "projects", label: "All projects", icon: FolderOpen, group: "Project", keywords: "open switch", run: go("project") },
      { id: "workspace", label: "Workspace", icon: ArrowRight, group: "Go to", keywords: "canvas screens design", run: go("") },
      { id: "tags", label: "Tags", icon: Tag, group: "Go to", keywords: "import plc variables csv", run: go("tags") },
      { id: "library", label: "Library", icon: Library, group: "Go to", keywords: "symbols graphics objects", run: go("library") },
      { id: "standards", label: "Standards", icon: Ruler, group: "Go to", keywords: "colours naming grid rules", run: go("standards") },
      { id: "validation", label: "Validation", icon: ShieldCheck, group: "Go to", keywords: "errors warnings check", run: go("validation") },
      { id: "export", label: "Export", icon: Download, group: "Go to", keywords: "eote download zip build", run: go("export") },
      { id: "history", label: "History", icon: History, group: "Go to", keywords: "versions revert undo", run: go("history") },

      ...TARGETS.map((t) => ({
        id: `target-${t.value}`,
        label: `Target ${t.label}`,
        icon: Monitor,
        group: "Panel",
        keywords: `${t.value} resolution screen size hardware`,
        active: `${target.model}|${target.width}|${target.height}` === t.value,
        run: () => {
          const [model, w, h] = t.value.split("|");
          setTarget({ model, width: Number(w), height: Number(h) });
          onClose();
        },
      })),

      { id: "theme-dark", label: "Dark theme", icon: Moon, group: "View", keywords: "appearance night", active: theme === "dark", run: () => { setTheme("dark"); onClose(); } },
      { id: "theme-light", label: "Light theme", icon: Sun, group: "View", keywords: "appearance day bright", active: theme === "light", run: () => { setTheme("light"); onClose(); } },
      { id: "grid", label: standards.showGrid ? "Hide the design grid" : "Show the design grid", icon: Ruler, group: "View", keywords: "grid snap guides", run: () => { setStandards({ showGrid: !standards.showGrid }); onClose(); } },
      { id: "rulers", label: standards.showRulers ? "Hide rulers" : "Show rulers", icon: Ruler, group: "View", keywords: "ruler measure", run: () => { setStandards({ showRulers: !standards.showRulers }); onClose(); } },
    ];
  }, [
    router, projectId, onClose, newProject, target, setTarget,
    theme, setTheme, standards, setStandards,
  ]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => setCursor(0), [query]);

  if (!open) return null;

  const groups = shown.reduce<Record<string, Command[]>>((acc, c) => {
    (acc[c.group] ??= []).push(c);
    return acc;
  }, {});
  const flat = Object.values(groups).flat();

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") return onClose();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => (c + 1) % Math.max(flat.length, 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => (c - 1 + flat.length) % Math.max(flat.length, 1));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      flat[cursor]?.run();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Commands"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-sm"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="animate-rise w-full max-w-xl overflow-hidden rounded-xl border border-line-strong bg-surface-float"
        style={{ boxShadow: "var(--elev-3)" }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-line-subtle px-4">
          <Search size={15} aria-hidden className="shrink-0 text-text-faint" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, a panel size, a page…"
            aria-label="Search commands"
            className="h-12 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-faint"
          />
          <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-text-faint">
            Esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {flat.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-text-muted">
              Nothing matches “{query}”.
            </p>
          )}

          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-1">
              <p className="label-eyebrow px-3 pb-1 pt-2">{group}</p>
              {items.map((command) => {
                const index = flat.indexOf(command);
                const Icon = command.icon;
                return (
                  <button
                    key={command.id}
                    type="button"
                    onPointerEnter={() => setCursor(index)}
                    onClick={command.run}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                      index === cursor
                        ? "bg-brand-500/12 text-text-primary"
                        : "text-text-secondary",
                    )}
                  >
                    <Icon size={15} aria-hidden className="shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                    {command.hint && (
                      <span className="shrink-0 text-xs text-text-faint">{command.hint}</span>
                    )}
                    {command.active && (
                      <Check size={14} aria-hidden className="shrink-0 text-brand-400" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Opens on Ctrl/Cmd+K anywhere that is not a text field. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen((o) => !o);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { open, setOpen };
}
