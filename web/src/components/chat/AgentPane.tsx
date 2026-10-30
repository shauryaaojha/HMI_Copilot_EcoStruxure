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

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Square, Undo2, Wrench, X } from "lucide-react";
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

export function AgentPane() {
  const sourceId = useProject((s) => s.sourceId);
  const hydrate = useProject((s) => s.hydrate);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [before, setBefore] = useState<Snapshot | null>(null);
  const abort = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const running = turns.some((t) => t.running);

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

  function submit() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    void run(text);
  }

  if (!sourceId) {
    return (
      <p className="relative p-4 text-[12px] leading-relaxed text-text-muted">
        The agent works on a project file: open an .eote from the start page, and it can read every screen, copy your own objects, bind tags and check the result.
      </p>
    );
  }

  return (
    <>
      <div ref={thread} className="relative min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-[12px] leading-relaxed text-text-muted">
              The agent opens this project&apos;s file, looks at how it is built, and changes it the way you would in the editor. You see every step; a change comes back as a new file, and you can put the old one back.
            </p>
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setDraft(idea)}
                className="focus-ring block w-full rounded-lg border border-line-subtle px-2.5 py-1.5 text-left text-[12px] text-text-secondary transition hover:border-line hover:bg-surface-hover"
              >
                {idea}
              </button>
            ))}
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <p key={i} className="ml-6 rounded-lg bg-brand-500/10 px-2.5 py-1.5 text-[12.5px] text-text-primary">
              {t.text}
            </p>
          ) : (
            <div key={i} className="space-y-1.5">
              {t.steps.length > 0 && (
                <ol className="space-y-0.5 rounded-lg border border-line-subtle bg-surface-raised/60 p-2 font-mono text-[10.5px] leading-snug">
                  {t.steps.map((s) => (
                    <li key={s.id} title={s.summary} className="flex gap-1.5">
                      {s.ok === undefined ? (
                        <span className="mt-0.5 h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent text-text-faint" />
                      ) : s.ok ? (
                        <Check size={11} className="mt-0.5 shrink-0 text-emerald-400" aria-label="done" />
                      ) : (
                        <X size={11} className="mt-0.5 shrink-0 text-amber-400" aria-label="failed" />
                      )}
                      <span className={cn("shrink-0", s.writes ? "text-brand-400" : "text-text-secondary")}>{s.name}</span>
                      <span className="truncate text-text-faint">{s.input}</span>
                    </li>
                  ))}
                </ol>
              )}
              {t.status && t.running && <p className="is-thinking text-[10.5px]">{t.status}</p>}
              {t.text && <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-text-primary">{t.text}</p>}
              {t.error && <p className="text-[11.5px] text-amber-400">{t.error}</p>}
              {t.changed && t.changed.length > 0 && (
                <p className="text-[10.5px] text-text-faint">Changed: {t.changed.join(", ")}</p>
              )}
            </div>
          ),
        )}

        {before && !running && (
          <button
            type="button"
            onClick={() => {
              hydrate(before);
              setBefore(null);
            }}
            className="focus-ring flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-text-muted transition hover:bg-surface-hover hover:text-text-primary"
          >
            <Undo2 size={12} aria-hidden /> Put back the project as it was before the agent&apos;s change
          </button>
        )}
      </div>

      <div className="relative shrink-0 border-t border-line-subtle p-3">
        <div className={cn("relative rounded-xl border bg-surface-raised transition", running ? "border-brand-500/40" : "border-line focus-within:border-brand-500/60")}>
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
              "focus-ring absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg transition",
              running || draft.trim() ? "bg-brand-500 text-text-onbrand hover:bg-brand-600" : "bg-surface-hover text-text-faint",
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
