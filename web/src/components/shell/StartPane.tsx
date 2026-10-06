"use client";

/**
 * What an empty project opens on.
 *
 * The workspace used to open on a fixture, so the first thing an engineer saw
 * was somebody else's pump station - a tool demonstrating itself rather than
 * helping. The first replacement was one input in the middle of a lot of
 * nothing, which is a different way of saying nothing.
 *
 * This asks one question, offers the three ways to answer it as real choices,
 * and then shows what will happen after the answer - because the hardest thing
 * about an empty canvas is not knowing what the tool is going to do with what
 * you give it.
 *
 * The reveal is a circle clipped out of this pane, collapsing into the point
 * that was clicked, so the canvas underneath is uncovered from exactly where
 * the engineer acted. Plain CSS: one transition on `clip-path`.
 */

import { expectJson } from "@/lib/ingest/client";
import type { Imported } from "@/components/projects/ProjectsScreen";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FileUp,
  FolderOpen,
  Loader2,
  PenLine,
  ScanEye,
  Send,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useProject } from "@/store/project";
import { useChat } from "@/components/chat/useChat";
import { SAMPLES, useTagImport } from "@/components/tags/useTagImport";
import { saveProject } from "@/store/persist";
import { touchProject } from "@/store/projects";
import { DEFAULT_STANDARDS } from "@/store/types";
import { cn } from "@/components/ui";
import { useCursorLight, useSpotlights } from "@/components/ui/interactions";

/** How long the circle takes to open. Matches the CSS transition below. */
const REVEAL_MS = 700;

/** What happens after the question is answered, in the pipeline's own order. */
const AFTER = [
  { icon: Workflow, label: "Equipment inferred", note: "from ISA-5.1 tag names" },
  { icon: PenLine, label: "Screens drawn", note: "ISA-101, in flow order" },
  { icon: ScanEye, label: "Reviewed", note: "overlaps, contrast, labels" },
  { icon: CheckCircle2, label: "Yours to approve", note: "nothing exported until you say" },
];

type Origin = { x: number; y: number };

export function StartPane({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [gone, setGone] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const tagPicker = useRef<HTMLInputElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  const variables = useProject((s) => s.variables);
  const hydrate = useProject((s) => s.hydrate);
  const { send } = useChat();
  const { upload, useSample } = useTagImport();
  const pane = useCursorLight<HTMLDivElement>();
  const cards = useSpotlights<HTMLDivElement>();

  useEffect(() => {
    box.current?.focus();
  }, []);

  const reveal = useCallback(
    (from?: Origin) => {
      setOrigin(from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      setTimeout(() => {
        setGone(true);
        onDone();
      }, REVEAL_MS);
    },
    [onDone],
  );

  const originOf = (e: { currentTarget: HTMLElement }): Origin => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const centre = (): Origin => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  function build(e: { currentTarget: HTMLElement }) {
    const text = draft.trim();
    if (!text) return;
    reveal(originOf(e));
    // The run starts behind the reveal, so the first objects land as the canvas
    // appears rather than after an empty pause.
    void send(text);
  }

  async function withTags(file: File, from: Origin) {
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
  async function openProject(file: File, from: Origin) {
    setBusy(file.name);
    setError(null);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: await file.arrayBuffer(),
      });
      const data = await expectJson<Imported>(response, "Opening that file");

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
        intent:
          `Opened ${file.name}` +
          (/\.vxdz$/i.test(file.name) ? " — exports as an .eote" : ""),
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
  const hasTags = variables.length > 0;

  return (
    <div
      ref={pane}
      className="absolute inset-0 z-30 overflow-y-auto bg-surface-base"
      style={{
        clipPath: origin ? `circle(0px at ${origin.x}px ${origin.y}px)` : undefined,
        transition: `clip-path ${REVEAL_MS}ms cubic-bezier(0.7, 0, 0.2, 1)`,
      }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid mask-fade opacity-[0.3]" />
      <div aria-hidden className="copilot-aurora pointer-events-none absolute inset-0 overflow-hidden" />
      <div aria-hidden className="cursor-light pointer-events-none absolute inset-0 hidden md:block" />

      <div className="relative mx-auto flex min-h-full max-w-3xl flex-col justify-center px-6 py-12">
        {/* --- the question -------------------------------------------- */}
        <div className="reveal is-in text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-raised/70 px-3 py-1 text-[11px] text-text-muted">
            <Sparkles size={11} aria-hidden className="text-brand-400" />
            New project
          </span>
          <h1 className="word-in mt-5 text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-tight tracking-tight">
            {"What are we building?".split(" ").map((w, i) => (
              <span key={i} style={{ ["--i" as string]: i }} className="mr-[0.25em]">
                {w}
              </span>
            ))}
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-text-muted">
            {hasTags
              ? `${variables.length} tags are loaded. Say which screens you need and the equipment is read from the names.`
              : "Describe the plant, bring a tag export, or open a project you already have. Any of the three is a start."}
          </p>
        </div>

        {/* --- the input ------------------------------------------------ */}
        <div
          className="beam-border reveal is-in mt-7 rounded-2xl border border-line-subtle bg-surface-raised shadow-xl shadow-black/20"
          style={{ ["--reveal-delay" as string]: "120ms" }}
        >
          <textarea
            ref={box}
            rows={3}
            value={draft}
            disabled={working}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                build(e as unknown as { currentTarget: HTMLElement });
              }
            }}
            placeholder={
              hasTags
                ? "A process overview, a faceplate per pump, and an alarm screen…"
                : "A transfer pump station with two duty pumps, a break tank and a discharge flow meter…"
            }
            className="w-full resize-none bg-transparent px-4 py-4 text-[14px] leading-relaxed text-text-primary outline-none placeholder:text-text-faint disabled:opacity-60"
          />
          <div className="flex items-center gap-1 border-t border-line-subtle px-2.5 py-2">
            <span className="px-1.5 font-mono text-[10px] text-text-faint">⏎ to build</span>
            <button
              type="button"
              disabled={working || draft.trim().length === 0}
              onClick={(e) => build(e)}
              className="focus-ring ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-text-onbrand transition hover:bg-brand-600 disabled:opacity-40"
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

        {/* --- the other two ways in ------------------------------------ */}
        <div
          ref={cards}
          className="reveal is-in mt-4 grid gap-3 sm:grid-cols-2"
          style={{ ["--reveal-delay" as string]: "200ms" }}
        >
          <button
            type="button"
            disabled={working}
            onClick={() => tagPicker.current?.click()}
            className="spotlight lift focus-ring group rounded-xl border border-line-subtle bg-surface-raised/60 p-4 text-left hover:border-brand-500/50 disabled:opacity-50"
          >
            <FileUp size={16} aria-hidden className="text-brand-400" />
            <h2 className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold">
              Import a tag export
              <ArrowRight size={13} aria-hidden className="opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              CSV, TSV or XLSX. Equipment is inferred from the names, deterministically.
            </p>
          </button>

          <button
            type="button"
            disabled={working}
            onClick={() => filePicker.current?.click()}
            className="spotlight lift focus-ring group rounded-xl border border-line-subtle bg-surface-raised/60 p-4 text-left hover:border-brand-500/50 disabled:opacity-50"
          >
            <FolderOpen size={16} aria-hidden className="text-brand-400" />
            <h2 className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold">
              Open a project
              <ArrowRight size={13} aria-hidden className="opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              An .eote, or a .vxdz from 3.4.1 on. It exports back unchanged everywhere
              you did not touch — always as an .eote, which is the format we write.
            </p>
          </button>
        </div>

        {/* --- samples -------------------------------------------------- */}
        {!hasTags && (
          <div className="reveal is-in pt-6" style={{ ["--reveal-delay" as string]: "280ms" }}>
            <p className="label-eyebrow pb-2 text-center">Or take a sample plant</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.path}
                  type="button"
                  disabled={working}
                  onClick={async () => {
                    setBusy(s.label);
                    setError(null);
                    try {
                      const loaded = await useSample(s);
                      if (!loaded) {
                        setError(`Could not load ${s.name}.`);
                        return;
                      }
                      setDraft(s.intent);
                      reveal(centre());
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
                  <span className="pl-1.5 font-mono text-[10px] text-text-faint">{s.tags}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* --- what happens next ---------------------------------------- */}
        <div
          className="reveal is-in mt-9 border-t border-line-subtle pt-6"
          style={{ ["--reveal-delay" as string]: "360ms" }}
        >
          <p className="label-eyebrow pb-3 text-center">Then, without being asked</p>
          <ol className="grid gap-y-3 sm:grid-cols-4">
            {AFTER.map(({ icon: Icon, label, note }, i) => (
              <li key={label} className="flex items-start gap-2.5 sm:flex-col sm:items-center sm:gap-1.5 sm:text-center">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-brand-400">
                  <Icon size={13} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-secondary">{label}</p>
                  <p className="text-[11px] leading-relaxed text-text-faint">{note}</p>
                </div>
                {i < AFTER.length - 1 && (
                  <span aria-hidden className="hidden sm:block" />
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <input
        ref={tagPicker}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xsy,.xvm,.xef,.xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void withTags(file, centre());
          e.target.value = "";
        }}
      />
      <input
        ref={filePicker}
        type="file"
        accept=".eote,.vxdz"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openProject(file, centre());
          e.target.value = "";
        }}
      />
    </div>
  );
}
