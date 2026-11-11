"use client";

/**
 * The agent, in the Copilot column: a job on the opened project's file.
 *
 * Unlike the chat, which proposes ops for the canvas, the agent works on the
 * .eote itself in a working directory on the server (/api/agent,
 * lib/agent): it reads the files, copies the engineer's own objects, binds
 * tags, and checks the result. Every step it takes is shown as it happens.
 * When it changed something, the server keeps the result as a new file and
 * the project here is reloaded from it; one click puts back what was open
 * before. The conversation lives in this pane only.
 */

import { useSignedOut } from "@/components/shell/SignInNotice";
import { holdDraft, openSignIn, takeDraft } from "@/lib/client/sign-in";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, CornerDownLeft, FileDiff, Square, Undo2, Wrench, X } from "lucide-react";
import { useProject } from "@/store/project";
import { cn } from "@/components/ui";

interface Step {
  id: string;
  name: string;
  input: string;
  writes: boolean;
  ok?: boolean;
  summary?: string;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  steps: Step[];
  status?: string;
  error?: string;
  changed?: string[];
  running?: boolean;
}

/** What a reload replaces, kept so the engineer can put it back. */
type Snapshot = Pick<ReturnType<typeof useProject.getState>, "screens" | "variables" | "alarms" | "bindings" | "foreign" | "source" | "sourceId">;

const IDEAS = [
  "How is the START button bound, and what does it write?",
  "Add a RESET push button made like START, bound to Flt_Reset",
  "Which tags are not shown on any screen?",
  "Check the project and tell me what would break in the editor",
];

function brief(input: unknown): string {
  const text = JSON.stringify(input ?? {});
  return text === "{}" ? "" : text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

export function AgentPane({ canEdit = true, onRunning }: { canEdit?: boolean; onRunning?: (running: boolean) => void }) {
  const sourceId = useProject((s) => s.sourceId);
  const hydrate = useProject((s) => s.hydrate);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const signedOut = useSignedOut();
  const [before, setBefore] = useState<Snapshot | null>(null);
  const abort = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const running = turns.some((t) => t.running);
  // The pane stays mounted behind the other modes, so the header can say it is still at work.
  useEffect(() => onRunning?.(running), [running, onRunning]);
  /** Seconds the job in hand has been running, so a long step is not mistaken for a stall. */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const update = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));

  async function run(text: string) {
    if (!sourceId || running) return;
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((all) => [...all, { role: "user", text, steps: [] }, { role: "assistant", text: "", steps: [], running: true }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceId, message: text, history }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `the agent answered ${response.status}`);
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line));
      }
    } catch (e) {
      if (!controller.signal.aborted) update((t) => ({ ...t, error: (e as Error).message }));
    } finally {
      update((t) => ({ ...t, running: false, status: undefined }));
      abort.current = null;
    }
  }

  function handle(e: Record<string, unknown>) {
    switch (e.type) {
      case "status":
        return update((t) => ({ ...t, status: String(e.message) }));
      case "text":
        return update((t) => ({ ...t, text: t.text ? `${t.text}\n\n${e.text}` : String(e.text) }));
      case "tool":
        return update((t) => ({ ...t, steps: [...t.steps, { id: String(e.id), name: String(e.name), input: brief(e.input), writes: !!e.writes }] }));
      case "result":
        return update((t) => ({ ...t, steps: t.steps.map((s) => (s.id === e.id ? { ...s, ok: !!e.ok, summary: String(e.summary) } : s)) }));
      case "error":
        return update((t) => ({ ...t, error: String(e.message) }));
      case "done": {
        const changes = (e.changes as { path: string; kind: string }[] | undefined) ?? [];
        return update((t) => ({ ...t, text: t.text || String(e.text ?? ""), changed: changes.map((c) => `${c.kind} ${c.path}`) }));
      }
      case "saved": {
        const p = e.project as Snapshot & { screens: Snapshot["screens"] };
        const s = useProject.getState();
        setBefore({ screens: s.screens, variables: s.variables, alarms: s.alarms, bindings: s.bindings, foreign: s.foreign, source: s.source, sourceId: s.sourceId });
        hydrate({
          screens: p.screens,
          variables: p.variables,
          alarms: p.alarms,
          bindings: p.bindings,
          foreign: p.foreign ?? {},
          source: String(e.sourceId),
          sourceId: String(e.sourceId),
          activeScreenId: p.screens.some((x) => x.UniqueId === s.activeScreenId) ? s.activeScreenId : p.screens[0]?.UniqueId,
        });
        return;
      }
    }
  }

  useEffect(() => {
    const waiting = takeDraft("agent");
    if (waiting) setDraft(waiting);
  }, []);

  function submit() {
    const text = draft.trim();
    if (!text || running) return;
    if (signedOut) {
      holdDraft("agent", text);
      openSignIn({ mode: "in", reason: "Sign in to use the Copilot." });
      return;
    }
    setDraft("");
    void run(text);
  }

  if (!canEdit) {
    return <p className="relative p-4 text-[12px] leading-relaxed text-text-muted">View only — the agent changes the project, so it needs an editor.</p>;
  }

  if (!sourceId) {
    return (
      <div className="relative m-3 space-y-2 rounded-xl border border-agent-500/30 bg-agent-500/[0.07] p-3 text-[12px] leading-relaxed">
        <p className="flex items-center gap-1.5 font-medium text-text-primary">
          <Wrench size={13} aria-hidden className="text-agent-400" /> The agent works on a project file
        </p>
        <p className="text-text-muted">
          Open an .eote from the start page and it can read every screen, copy your own objects, bind tags and check the result. For a project
          built here from tags, use Chat.
        </p>
      </div>
    );
  }

  return (
    <>
      <div ref={thread} className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-text-secondary">
              Give it a job, not a sentence to draw.
              <span className="mt-1 block text-text-muted">
                It opens this project&apos;s file, works step by step where you can see, and hands back a new file. One click puts the old one back.
              </span>
            </p>
            <div>
              <p className="label-eyebrow pb-2">Jobs it does well</p>
              <ul className="space-y-1.5">
                {IDEAS.map((idea) => (
                  <li key={idea}>
                    <button
                      type="button"
                      onClick={() => setDraft(idea)}
                      className="focus-ring press group flex w-full items-start gap-2 rounded-lg border border-line-subtle bg-surface-raised/50 px-3 py-2 text-left text-xs leading-relaxed text-text-secondary hover:border-agent-500/40 hover:bg-surface-raised hover:text-text-primary"
                    >
                      <CornerDownLeft size={12} aria-hidden className="mt-0.5 shrink-0 text-text-faint transition group-hover:text-agent-400" />
                      <span className="min-w-0">{idea}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="animate-rise flex justify-end">
              <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-agent-500/25 bg-agent-500/12 px-3 py-2 text-[12.5px] leading-relaxed text-text-primary">
                {t.text}
              </p>
            </div>
          ) : (
            <div key={i} className="animate-rise space-y-2">
              {/* The work, as a run of steps on one line down the side: a read is a
                  ring, a write is filled, and the one in hand turns. */}
              {t.steps.length > 0 && (
                <ol className="relative space-y-1.5 pl-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
                  {t.steps.map((s) => (
                    <li key={s.id} className="animate-rise relative">
                      <span
                        aria-hidden
                        className={cn(
                          "absolute -left-4 top-1 flex h-[11px] w-[11px] items-center justify-center rounded-full border bg-surface-copilot",
                          s.ok === undefined ? "border-agent-400" : s.ok ? (s.writes ? "border-agent-400 bg-agent-400" : "border-line-strong") : "border-status-warn bg-status-warn",
                        )}
                      >
                        {s.ok === undefined && <span className="h-[5px] w-[5px] animate-ping rounded-full bg-agent-400" />}
                      </span>
                      <details className="group/step">
                        <summary className="flex cursor-pointer list-none items-baseline gap-1.5 text-[11px] leading-snug">
                          <span className={cn("text-ident shrink-0 rounded px-1 py-px", s.writes ? "bg-agent-500/15 text-agent-300" : "bg-surface-hover text-text-secondary")}>{s.name}</span>
                          <span className="text-ident min-w-0 flex-1 truncate text-text-faint">{s.input}</span>
                          {s.ok === true && <Check size={10} aria-label="done" className="shrink-0 self-center text-text-faint" />}
                          {s.ok === false && <X size={10} aria-label="failed" className="shrink-0 self-center text-status-warn" />}
                        </summary>
                        {s.summary && <p className="mt-1 whitespace-pre-wrap rounded-md bg-surface-raised/70 px-2 py-1.5 text-[11px] leading-relaxed text-text-muted">{s.summary}</p>}
                      </details>
                    </li>
                  ))}
                </ol>
              )}
              {t.running && (
                <p className="flex items-center gap-2 text-[11px]">
                  <span className="is-thinking font-medium">{t.status ?? (t.steps.length ? "Working…" : "Opening the project file…")}</span>
                  <span className="text-figure text-text-faint">{elapsed}s</span>
                </p>
              )}
              {t.text && <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">{t.text}</p>}
              {t.error && (
                <p className="rounded-lg border border-status-warn/30 bg-status-warn/[0.08] px-2.5 py-2 text-[11px] leading-snug text-status-warn">{t.error}</p>
              )}
              {t.changed && t.changed.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {t.changed.map((c) => (
                    <li key={c} className="text-ident inline-flex items-center gap-1 rounded-md border border-agent-500/30 bg-agent-500/[0.08] px-1.5 py-0.5 text-agent-300">
                      <FileDiff size={10} aria-hidden /> {c}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ),
        )}

        {before && !running && (
          <div className="animate-rise flex items-center gap-2 rounded-xl border border-line-subtle bg-surface-raised/60 p-2.5">
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-text-muted">The project was reloaded from the agent&apos;s file.</p>
            <button
              type="button"
              onClick={() => {
                hydrate(before);
                setBefore(null);
              }}
              className="focus-ring press flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              <Undo2 size={12} aria-hidden /> Put it back
            </button>
          </div>
        )}
      </div>

      <div className="relative shrink-0 border-t border-line-subtle p-3">
        <div
          className={cn("relative rounded-xl border bg-surface-raised transition", running ? "border-agent-500/50" : "border-line focus-within:border-agent-500/60")}
          style={{ boxShadow: running ? "0 0 0 1px color-mix(in srgb, var(--mode) 30%, transparent), 0 0 24px color-mix(in srgb, var(--mode) 16%, transparent)" : "var(--elev-1)" }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            maxLength={4000}
            disabled={running}
            aria-label="Give the agent a job"
            placeholder="Give the agent a job on this project…"
            className="w-full resize-none bg-transparent px-3 py-2.5 pr-11 text-[13px] leading-relaxed text-text-primary outline-none placeholder:text-text-faint disabled:opacity-60"
          />
          <button
            type="button"
            onClick={running ? () => abort.current?.abort() : submit}
            disabled={!running && !draft.trim()}
            aria-label={running ? "Stop" : "Send"}
            title={running ? "Stop the agent" : "Send (Enter)"}
            className={cn(
              "focus-ring press absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg",
              running || draft.trim() ? "bg-agent-500 text-white shadow-md shadow-agent-500/30 hover:brightness-110" : "bg-surface-hover text-text-faint",
            )}
          >
            {running ? <Square size={11} aria-hidden /> : <ArrowUp size={14} aria-hidden />}
          </button>
        </div>
        <p className="flex items-center gap-1 pt-1.5 text-[10px] text-text-faint">
          <Wrench size={10} aria-hidden /> Works on the file; your open project is reloaded from what it saves.
        </p>
      </div>
    </>
  );
}
