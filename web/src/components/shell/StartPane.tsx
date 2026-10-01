"use client";

/**
 * What an empty project opens on.
 *
 * The workspace used to open on a fixture, so the first thing an engineer saw
 * was somebody else's pump station - a tool demonstrating itself rather than
 * helping. Now an empty project opens on one question and the three ways to
 * answer it: say what you need, bring a tag export, or open a project you
 * already have.
 *
 * The reveal is a circle clipped out of this pane, collapsing into the point
 * that was clicked, so the canvas underneath is uncovered from exactly where
 * the engineer acted. Plain CSS: one transition on `clip-path`. Nothing here
 * is worth a animation dependency, and a dependency that ships to a panel in a
 * plant is worth avoiding twice.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, FolderOpen, Loader2, Send, Sparkles } from "lucide-react";
import { useProject } from "@/store/project";
import { useChat } from "@/components/chat/useChat";
import { SAMPLES, useTagImport } from "@/components/tags/useTagImport";
import { saveProject } from "@/store/persist";
import { touchProject } from "@/store/projects";
import { DEFAULT_STANDARDS } from "@/store/types";
import { cn } from "@/components/ui";

/** How long the circle takes to open. Matches the CSS transition below. */
const REVEAL_MS = 700;

export function StartPane({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [gone, setGone] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const tagPicker = useRef<HTMLInputElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  const variables = useProject((s) => s.variables);
  const hydrate = useProject((s) => s.hydrate);
  const { send } = useChat();
  const { upload, useSample } = useTagImport();

  useEffect(() => {
    box.current?.focus();
  }, []);

  /** Uncover the canvas from where the engineer clicked, then stand down. */
  const reveal = useCallback(
    (from?: { x: number; y: number }) => {
      setOrigin(from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      setTimeout(() => {
        setGone(true);
        onDone();
      }, REVEAL_MS);
    },
    [onDone],
  );

  const originOf = (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  async function build(e: { currentTarget: HTMLElement }) {
    const text = draft.trim();
    if (!text) return;
    reveal(originOf(e));
    // The run starts behind the reveal, so the first objects land as the
    // canvas appears rather than after an empty pause.
    void send(text);
  }

  async function withTags(file: File, from: { x: number; y: number }) {
    setBusy(file.name);
    setError(null);
    try {
      const result = await upload(file);
      if (result) reveal(from);
      else setError("That file could not be read as a tag export.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Open an .eote into *this* project rather than creating another one: the
   * engineer asked for a project and is already standing in it. The bytes stay
   * on the server so the export can write back into them.
   */
  async function openProject(file: File, from: { x: number; y: number }) {
    setBusy(file.name);
    setError(null);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: await file.arrayBuffer(),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error ?? `could not open that file (${response.status})`);

      const payload = {
        id: projectId,
        name: data.name,
        target: data.target,
        screens: data.screens,
        activeScreenId: data.screens[0]?.UniqueId,
        variables: data.variables,
        alarms: data.alarms,
        bindings: data.bindings,
        objectMeta: {},
        screenPlacement: {},
        standards: DEFAULT_STANDARDS,
        versions: [],
        chat: [],
        source: data.source,
        foreign: data.foreign ?? {},
      };
      hydrate(payload);
      saveProject(payload);
      touchProject(projectId, {
        name: data.name,
        screens: data.screens.length,
        objects: data.screens.reduce(
          (n: number, s: { Children: { Children: unknown[] }[] }) => n + s.Children[0].Children.length,
          0,
        ),
        tags: data.variables.length,
        target: `${data.target.model} · ${data.target.width} × ${data.target.height}`,
        intent: `Opened ${file.name}`,
      });
      reveal(from);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not open that file");
    } finally {
      setBusy(null);
    }
  }

  if (gone) return null;

  const working = busy !== null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-surface-base px-6 py-10"
      style={{
        clipPath: origin ? `circle(0px at ${origin.x}px ${origin.y}px)` : undefined,
        transition: `clip-path ${REVEAL_MS}ms cubic-bezier(0.7, 0, 0.2, 1)`,
      }}
    >
      <div aria-hidden className="copilot-aurora pointer-events-none absolute inset-0 overflow-hidden" />

      <div className="relative w-full max-w-2xl">
        <div className="flex items-center justify-center gap-2 pb-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
            <Sparkles size={15} aria-hidden />
          </span>
          <h1 className="text-[15px] font-medium text-text-primary">What are we building?</h1>
        </div>

        <div className="rounded-2xl border border-line-subtle bg-surface-raised shadow-lg shadow-black/20 focus-within:border-brand-500/50">
          <textarea
            ref={box}
            rows={3}
            value={draft}
            disabled={working}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void build(e as unknown as { currentTarget: HTMLElement });
              }
            }}
            placeholder={
              variables.length > 0
                ? `Describe the screens to build from these ${variables.length} tags…`
                : "Describe the plant and the screens you need. Import a tag export first and the equipment is inferred from the names."
            }
            className="w-full resize-none bg-transparent px-4 py-3.5 text-[13px] leading-relaxed text-text-primary outline-none placeholder:text-text-faint disabled:opacity-60"
          />
          <div className="flex items-center gap-2 border-t border-line-subtle px-3 py-2">
            <button
              type="button"
              disabled={working}
              onClick={() => tagPicker.current?.click()}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            >
              <FileUp size={13} aria-hidden /> Tag export
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => filePicker.current?.click()}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            >
              <FolderOpen size={13} aria-hidden /> Open an .eote
            </button>
            <button
              type="button"
              disabled={working || draft.trim().length === 0}
              onClick={(e) => void build(e)}
              className="focus-ring ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-400 disabled:opacity-40"
            >
              {working ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Send size={13} aria-hidden />}
              Build it
            </button>
          </div>
        </div>

        {busy && <p className="pt-3 text-center text-xs text-text-muted">Reading {busy}…</p>}
        {error && (
          <p className="mt-3 rounded-lg border border-status-alarm/40 bg-status-alarm/10 p-2.5 text-center text-xs text-status-alarm">
            {error}
          </p>
        )}

        {variables.length === 0 && (
          <div className="pt-6">
            <p className="label-eyebrow pb-2 text-center">Or start from a sample plant</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.path}
                  type="button"
                  disabled={working}
                  onClick={async (e) => {
                    const from = originOf(e);
                    setBusy(s.label);
                    setError(null);
                    try {
                      const loaded = await useSample(s);
                      if (!loaded) {
                        setError(`Could not load ${s.name}.`);
                        return;
                      }
                      setDraft(s.intent);
                      reveal(from);
                      void send(s.intent);
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className={cn(
                    "focus-ring rounded-full border border-line-subtle bg-surface-raised/60 px-3 py-1.5 text-xs text-text-secondary transition",
                    "hover:border-brand-500/40 hover:text-text-primary disabled:opacity-50",
                  )}
                >
                  {s.label}
                  <span className="pl-1.5 text-text-faint">{s.tags} tags</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="pt-6 text-center text-[11px] text-text-faint">
          Nothing is exported until you say so, and every change can be undone.
        </p>
      </div>

      <input
        ref={tagPicker}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const r = e.target.getBoundingClientRect();
          if (file) void withTags(file, { x: r.left || window.innerWidth / 2, y: r.top || window.innerHeight / 2 });
          e.target.value = "";
        }}
      />
      <input
        ref={filePicker}
        type="file"
        accept=".eote"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openProject(file, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
          e.target.value = "";
        }}
      />
    </div>
  );
}
