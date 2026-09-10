"use client";

/**
 * The left pane: one conversation, top to bottom.
 *
 * An engineer does not describe a screen correctly the first time. They ask,
 * look, and ask again - "move the flow reading up", "the fault lamp should be
 * red", "add a second screen for the filters" - until it is right. So this is
 * not a prompt box with an output pane under it: it is a conversation with the
 * project, and every turn records what it changed so the thread doubles as the
 * build log.
 *
 * Three things make it usable rather than a chat toy:
 *   - a turn that changed something lists the changes, and links back to the
 *     version it produced, so any turn can be undone as a unit;
 *   - a turn that could not be acted on asks a specific question, and the
 *     questions are buttons;
 *   - what the assistant needs before it can proceed is stated as a checklist
 *     computed from the project, not as an interrogation.
 *
 * On the look: this pane had the same flat ground as every other panel, which
 * made the one place where something is actually happening indistinguishable
 * from the places where nothing is. It has its own surface now, two very dim
 * brand-coloured blooms behind the thread, and motion tied to real state - the
 * reply shimmers only while it is being produced, each change line rises as it
 * lands. Nothing here animates for decoration.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  CornerDownLeft,
  Info,
  Plus,
  RotateCcw,
  Sparkles,
  SquarePen,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useProject } from "@/store/project";
import { useNewProject } from "@/components/shell/useNewProject";
import { SAMPLES } from "@/components/tags";
import { cn } from "@/components/ui";
import { anythingMissing, requirementsOf } from "./requirements";
import { useChat } from "./useChat";

const MAX_INTENT = 600;

/**
 * Openers that show the *shapes* a request can take, not a worked example.
 *
 * They were written around the demo's pump station, which meant a brand-new
 * project opened suggesting equipment it did not have. These are phrased so
 * they read as a form to fill in against whatever tags were imported.
 */
const OPENERS = [
  "Create a screen for <equipment>, showing status and readings",
  "Add a plant overview above the screens I have",
  "Move <object> clear of the alarm banner",
  "Add a high alarm on <tag>",
];

export function ChatPanel() {
  const [draft, setDraft] = useState("");
  const chat = useProject((s) => s.chat);
  const generating = useProject((s) => s.generating);
  const variables = useProject((s) => s.variables);
  const screens = useProject((s) => s.screens);
  const alarms = useProject((s) => s.alarms);
  const target = useProject((s) => s.target);
  const clearChat = useProject((s) => s.clearChat);
  const tagImport = useProject((s) => s.tagImport);
  const restore = useProject((s) => s.restore);
  const projectId = useProject((s) => s.id);

  /**
   * Once a known sample is loaded, the objection to a worked example goes away:
   * the equipment it names is equipment this project has. So the opener list
   * gains the sentence that sample was written for, and its follow-ups appear
   * after the first screen exists.
   */
  const sample = SAMPLES.find((s) => s.name === tagImport?.fileName);
  const openers =
    sample && screens.length === 0
      ? // One screen first, then the whole application - in that order, because
        // the second is a much larger ask and seeing the first land is what
        // makes it credible.
        [sample.intent, ...(sample.intentFull ? [sample.intentFull] : []), ...OPENERS]
      : sample
        ? [...sample.followUps, ...OPENERS]
        : OPENERS;

  const { send } = useChat();
  const newProject = useNewProject();
  const thread = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const requirements = useMemo(
    () => requirementsOf({ variables, screens, alarms, target }),
    [variables, screens, alarms, target],
  );
  const missing = anythingMissing(requirements);
  const working = chat.some((m) => m.pending) || generating;
  // A new project has one empty screen, so "is there anything here yet?" is a
  // question about objects, not about screens.
  const hasContent = screens.some((s) => s.Children[0].Children.length > 0);

  /**
   * Follow the tail, but release the moment the engineer scrolls up.
   *
   * Not before there is a tail to follow. With no messages this pane holds the
   * opening explanation, the openers and the checklist, and scrolling that to
   * its bottom on mount cut the first line off - the project opened mid-sentence
   * at "is right. Every turn edits the project you can see".
   */
  useEffect(() => {
    const el = thread.current;
    if (!el || !pinned.current || chat.length === 0) return;
    el.scrollTop = el.scrollHeight;
  }, [chat, working]);

  function submit() {
    const text = draft.trim();
    if (!text || working) return;
    setDraft("");
    pinned.current = true;
    void send(text);
  }

  return (
    <aside className="relative flex h-full w-full min-h-0 flex-col bg-surface-copilot">
      {/* Two slow brand-coloured blooms, behind everything, at 16% and 10%. */}
      <div
        aria-hidden
        className="copilot-aurora pointer-events-none absolute inset-0 overflow-hidden"
      />

      <header className="relative flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-md bg-brand-500/15 text-brand-400",
            working && "animate-breathe",
          )}
          style={working ? { boxShadow: "var(--glow-brand)" } : undefined}
        >
          <Sparkles size={12} aria-hidden />
        </span>
        <h2 className="text-[13px] font-semibold tracking-tight text-text-primary">
          Copilot
        </h2>
        {working && (
          <span className="is-thinking text-[10px] font-medium uppercase tracking-wider">
            working
          </span>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {chat.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              title="Clear the conversation. The screens stay."
              className="focus-ring rounded-md p-1.5 text-text-faint transition hover:bg-surface-hover hover:text-text-secondary"
              aria-label="Clear the conversation"
            >
              <Trash2 size={12} aria-hidden />
            </button>
          )}
          {/* Starts a project, not just a thread: a conversation and the screens
              it built are the same piece of work, so "new chat" that left the
              old screens on the canvas would be the confusing half-measure. */}
          <button
            type="button"
            onClick={() => newProject()}
            title="New chat - a blank canvas and an empty conversation. This project stays on the Projects page."
            className="focus-ring flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-text-muted transition hover:bg-surface-hover hover:text-text-primary"
          >
            <SquarePen size={12} aria-hidden />
            New
          </button>
        </div>
      </header>

      {/* The thread. Takes whatever height is left and scrolls on its own. */}
      <div
        ref={thread}
        onScroll={() => {
          const el = thread.current;
          if (!el) return;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
        className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4"
        aria-live="polite"
        aria-label="Conversation"
      >
        {chat.length === 0 && (
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-text-secondary">
              Describe what you need and keep going until it is right.
              <span className="mt-1 block text-text-muted">
                Every turn edits the project you can see, and every turn can be
                undone.
              </span>
            </p>

            {/* A new project has no tags, and equipment is inferred from tag
                names - so without these the first request has nothing to build
                from. Both routes in, rather than an error after the fact. */}
            {variables.length === 0 && (
              <div className="space-y-2 rounded-lg border border-status-info/30 bg-status-info/[0.06] p-3">
                <p className="text-xs leading-relaxed text-status-info">
                  No PLC tags yet. Equipment is inferred from tag names, so a
                  screen needs them.
                </p>
                <Link
                  href={`/project/${projectId}/tags`}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-status-info/40 px-2.5 py-1 text-xs font-medium text-status-info transition hover:bg-status-info/10"
                >
                  <Plus size={12} aria-hidden />
                  Import a tag export
                </Link>
              </div>
            )}

            <div>
              <p className="label-eyebrow pb-2">Try</p>
              <ul className="space-y-1.5">
                {openers.map((opener) => (
                  <li key={opener}>
                    <button
                      type="button"
                      onClick={() => setDraft(opener)}
                      className="focus-ring group flex w-full items-start gap-2 rounded-lg border border-line-subtle bg-surface-raised/50 px-3 py-2 text-left text-xs leading-relaxed text-text-secondary transition hover:border-brand-500/40 hover:bg-surface-raised hover:text-text-primary"
                    >
                      <CornerDownLeft
                        size={12}
                        aria-hidden
                        className="mt-0.5 shrink-0 text-text-faint transition group-hover:text-brand-400"
                      />
                      <span className="min-w-0">{opener}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-line-subtle p-3">
              <p className="label-eyebrow flex items-center gap-1.5 pb-2">
                <Info size={11} aria-hidden />
                What a request needs
              </p>
              <ul className="space-y-2">
                {requirements.map((r) => (
                  <li key={r.id} className="flex gap-2 text-xs leading-snug">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full",
                        r.met
                          ? "bg-status-ok/15 text-status-ok"
                          : "bg-surface-hover text-text-faint",
                      )}
                    >
                      {r.met ? <Check size={9} strokeWidth={3} /> : "·"}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-text-secondary">{r.label}</span>
                      <span className="mt-0.5 block text-text-faint">{r.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {chat.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="animate-rise flex justify-end">
              <p className="max-w-[92%] rounded-xl rounded-br-sm border border-brand-500/20 bg-brand-500/10 px-3 py-2 text-xs leading-relaxed text-text-primary">
                {message.text}
              </p>
            </div>
          ) : (
            <div key={message.id} className="animate-rise space-y-2">
              {message.pending && !message.text ? (
                <p className="is-thinking text-[13px] font-medium">
                  Reading the request&hellip;
                </p>
              ) : (
                message.text && (
                  <p className="text-[13px] leading-relaxed text-text-secondary">
                    {message.text}
                  </p>
                )
              )}

              {message.questions && message.questions.length > 0 && (
                <ul className="space-y-1.5">
                  {message.questions.map((question) => (
                    <li key={question}>
                      <button
                        type="button"
                        onClick={() => setDraft(question)}
                        title="Put this in the box to answer it"
                        className="focus-ring w-full rounded-lg border border-status-info/30 bg-status-info/[0.06] px-3 py-2 text-left text-xs leading-relaxed text-status-info transition hover:border-status-info/60 hover:bg-status-info/10"
                      >
                        {question}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {message.changes && message.changes.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-line-subtle bg-surface-raised/40 p-2.5">
                  {message.changes.map((change, i) => (
                    <li
                      key={i}
                      className="animate-rise flex gap-2 text-[11px] leading-relaxed text-text-muted"
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    >
                      <Check
                        size={11}
                        aria-hidden
                        strokeWidth={2.5}
                        className="mt-0.5 shrink-0 text-brand-400"
                      />
                      <span className="min-w-0">{change}</span>
                    </li>
                  ))}
                </ul>
              )}

              {message.error && (
                <p className="flex gap-2 rounded-lg border border-status-warn/30 bg-status-warn/[0.08] px-2.5 py-2 text-[11px] leading-snug text-status-warn">
                  <AlertTriangle size={12} aria-hidden className="mt-px shrink-0" />
                  {message.error}
                </p>
              )}

              {(message.versionAt || message.provider) && !message.pending && (
                <div className="flex items-center gap-2 text-[10px]">
                  {message.provider && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-medium",
                        message.provider === "local"
                          ? "bg-status-warn/15 text-status-warn"
                          : "bg-surface-hover text-text-muted",
                      )}
                    >
                      {message.provider}
                    </span>
                  )}
                  {message.versionAt && (
                    <button
                      type="button"
                      onClick={() => restore(message.versionAt!)}
                      title="Put the project back the way this turn left it"
                      className="focus-ring inline-flex items-center gap-1 rounded text-text-faint transition hover:text-brand-400"
                    >
                      <RotateCcw size={10} aria-hidden />
                      revert to here
                    </button>
                  )}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      {/* The composer, pinned to the foot of the same column. */}
      <div className="relative shrink-0 border-t border-line-subtle p-3">
        {missing && chat.length > 0 && (
          <p className="pb-2 text-[11px] leading-snug text-text-faint">
            {requirements
              .filter((r) => r.id !== "subject" && !r.met)
              .map((r) => r.detail)
              .join(" ")}
          </p>
        )}

        <div
          className={cn(
            "relative rounded-xl border bg-surface-raised transition",
            working ? "border-brand-500/40" : "border-line focus-within:border-brand-500/60",
          )}
          style={{ boxShadow: working ? "var(--glow-brand)" : "var(--elev-1)" }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline, which is the convention
              // everywhere an engineer has typed into a box before.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            maxLength={MAX_INTENT}
            rows={3}
            disabled={working}
            aria-label="Describe what you need"
            placeholder={
              hasContent
                ? "Ask for a change, or another screen…"
                : "Describe the screen you need…"
            }
            className="w-full resize-none bg-transparent px-3 py-2.5 pr-11 text-[13px] leading-relaxed text-text-primary outline-none placeholder:text-text-faint disabled:opacity-60"
          />

          <button
            type="button"
            disabled={!draft.trim() || working}
            onClick={submit}
            aria-label="Send"
            title="Send (Enter)"
            className={cn(
              "focus-ring absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg transition",
              draft.trim() && !working
                ? "bg-brand-500 text-text-onbrand hover:bg-brand-600"
                : "bg-surface-hover text-text-faint",
            )}
          >
            {working ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
            ) : (
              <ArrowUp size={14} aria-hidden />
            )}
          </button>
        </div>

        <p className="pt-1.5 text-[10px] text-text-faint">
          <kbd className="rounded border border-line-subtle px-1">Enter</kbd> to send
          {" · "}
          <kbd className="rounded border border-line-subtle px-1">Shift</kbd>+
          <kbd className="rounded border border-line-subtle px-1">Enter</kbd> for a new
          line
        </p>
      </div>
    </aside>
  );
}
