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

import { takeDraft } from "@/lib/client/sign-in";
import { SignInNotice } from "@/components/shell/SignInNotice";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronRight,
  CornerDownLeft,
  Info,
  MessagesSquare,
  Plug,
  Plus,
  RotateCcw,
  Sparkles,
  SquarePen,
  Trash2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useProject } from "@/store/project";
import { useCanEdit } from "@/store/access";
import { useNewProject } from "@/components/shell/useNewProject";
import { SAMPLES } from "@/components/tags";
import { cn } from "@/components/ui";
import { anythingMissing, requirementsOf } from "./requirements";
import { useChat } from "./useChat";
import { SharedProposals, fromMcp, notFromMcp } from "./SharedProposals";
import { AgentPane } from "./AgentPane";
import { ConnectorPane } from "./ConnectorPane";
import { useProposals } from "@/store/proposals";

const MAX_INTENT = 600;

/**
 * Openers that show the *shapes* a request can take, not a worked example.
 *
 * They were written around the demo's pump station, which meant a brand-new
 * project opened suggesting equipment it did not have. These are phrased so
 * they read as a form to fill in against whatever tags were imported.
 */
type Mode = "chat" | "agent" | "connector";

/**
 * Three ways of working on one project, and they are not the same kind of
 * thing: the chat proposes changes on the canvas, the agent does a job on the
 * project's file step by step, and the connector is Claude working from
 * outside. Each keeps its own hue (globals.css, data-mode) and its own pane,
 * and all three stay mounted, so a job the agent is doing carries on while the
 * chat is asked for something else.
 */
const MODES: { id: Mode; label: string; icon: typeof Sparkles; title: string }[] = [
  { id: "chat", label: "Chat", icon: MessagesSquare, title: "Ask for a change and see it on the canvas before it is applied" },
  { id: "agent", label: "Agent", icon: Wrench, title: "Give a job on the opened project file; it works step by step" },
  { id: "connector", label: "MCP", icon: Plug, title: "Claude over MCP: connect it, and see the changes it proposed for this project" },
];

const OPENERS = [
  "Create a screen for <equipment>, showing status and readings",
  "Add a plant overview above the screens I have",
  "Move <object> clear of the alarm banner",
  "Add a high alarm on <tag>",
];

export function ChatPanel() {
  const [draft, setDraft] = useState("");
  /** The chat proposes ops for the canvas; the agent works on the opened file. */
  const [mode, setMode] = useState<Mode>("chat");
  const [agentRunning, setAgentRunning] = useState(false);
  /** Changes waiting for a decision, whoever asked for them. */
  const waiting = useProposals((s) => s.list.filter((p) => p.status === "open" && fromMcp(p)).length);
  const chat = useProject((s) => s.chat);
  const generating = useProject((s) => s.generating);
  const variables = useProject((s) => s.variables);
  const screens = useProject((s) => s.screens);
  const alarms = useProject((s) => s.alarms);
  const target = useProject((s) => s.target);
  const clearChat = useProject((s) => s.clearChat);
  const tagImport = useProject((s) => s.tagImport);
  const restore = useProject((s) => s.restore);
  const storeId = useProject((s) => s.id);
  const projectId = useParams<{ id?: string }>()?.id ?? storeId;
  // Every turn edits the project, so a viewer or commenter reads the
  // conversation but cannot add to it, apply what it proposed, revert to a
  // turn or clear it.
  const canEdit = useCanEdit();

  // A project with changes from Claude waiting and nothing said in the chat
  // yet - the usual state of one Claude just created - opens on the MCP tab,
  // once, so the proposals are the first thing seen rather than an empty chat.
  const openedOnMcp = useRef<string | null>(null);
  useEffect(() => {
    if (waiting > 0 && chat.length === 0 && openedOnMcp.current !== projectId) {
      openedOnMcp.current = projectId;
      setMode("connector");
    }
  }, [waiting, chat.length, projectId]);

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

  const { send, accept, discard, previewSome } = useChat();
  /** Per pending proposal, the ops left ticked; absent means all of them. */
  const [kept, setKept] = useState<Record<string, number[]>>({});
  const keptFor = (id: string, n: number) => kept[id] ?? Array.from({ length: n }, (_, i) => i);
  const toggleOp = (id: string, n: number, i: number) => {
    const now = keptFor(id, n);
    const next = now.includes(i) ? now.filter((x) => x !== i) : [...now, i].sort((a, b) => a - b);
    setKept((k) => ({ ...k, [id]: next }));
    previewSome(id, next);
  };
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

  useEffect(() => {
    const waiting = takeDraft("chat");
    if (waiting) setDraft(waiting);
  }, []);

  function submit() {
    const text = draft.trim();
    if (!text || working) return;
    setDraft("");
    pinned.current = true;
    void send(text).then((sent) => {
      if (sent === false) setDraft(text);
    });
  }

  return (
    <aside data-mode={mode} className="relative flex h-full w-full min-h-0 flex-col bg-surface-copilot">
      {/* Two slow blooms behind everything, in the hue of the mode in use. */}
      <div
        aria-hidden
        className="copilot-aurora pointer-events-none absolute inset-0 overflow-hidden"
      />

      <header className="relative shrink-0 px-3 pb-2.5 pt-3">
        <div className="flex h-6 items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-lg transition-colors duration-300",
              (working || agentRunning) && "animate-breathe",
            )}
            style={{ color: "var(--mode)", background: "color-mix(in srgb, var(--mode) 16%, transparent)" }}
          >
            <Sparkles size={12} aria-hidden />
          </span>
          <h2 className="text-sm font-semibold tracking-tight text-text-primary">
            Copilot
          </h2>
          {(working || agentRunning) && (
            <span className="is-thinking text-[10px] font-medium uppercase tracking-wider">
              {working && agentRunning ? "chat and agent working" : agentRunning ? "agent working" : "working"}
            </span>
          )}

          <div className="ml-auto flex items-center gap-0.5">
            {mode === "chat" && chat.length > 0 && canEdit && (
              <button
                type="button"
                onClick={clearChat}
                title="Clear the conversation. The screens stay."
                className="focus-ring press rounded-md p-1.5 text-text-faint hover:bg-surface-hover hover:text-text-secondary"
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
              className="focus-ring press flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-text-muted hover:bg-surface-hover hover:text-text-primary"
            >
              <SquarePen size={12} aria-hidden />
              New
            </button>
          </div>
        </div>

        {/* Who is working. The thumb slides to the mode in use and takes its hue. */}
        <div role="tablist" aria-label="Copilot mode" className="relative mt-2.5 grid grid-cols-3 rounded-xl border border-line-subtle bg-surface-base/70 p-1">
          <span
            aria-hidden
            className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-lg border shadow-[var(--elev-1)] transition-transform duration-300 ease-[var(--ease-out)] motion-reduce:transition-none"
            style={{
              transform: `translateX(${MODES.findIndex((m) => m.id === mode) * 100}%)`,
              background: "color-mix(in srgb, var(--mode) 14%, var(--color-surface-raised))",
              borderColor: "color-mix(in srgb, var(--mode) 40%, transparent)",
            }}
          />
          {MODES.map(({ id, label, icon: Icon, title }) => {
            const busy = id === "chat" ? working : id === "agent" ? agentRunning : waiting > 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                title={title}
                className={cn(
                  "focus-ring relative flex h-7 items-center justify-center gap-1.5 rounded-md text-[11.5px] font-medium transition-colors duration-200",
                  mode === id ? "text-text-primary" : "text-text-muted hover:text-text-secondary",
                )}
              >
                <Icon size={12} aria-hidden style={mode === id ? { color: "var(--mode)" } : undefined} />
                {label}
                {/* A dot on a mode that is not the one in view: it is still at work there. */}
                {busy && (
                  <span
                    aria-label={id === "connector" ? `${waiting} waiting` : "working"}
                    className={cn(
                      "dot-live h-1.5 w-1.5 rounded-full",
                      id === "chat" ? "bg-brand-400 text-brand-400" : id === "agent" ? "bg-agent-400 text-agent-400" : "bg-connector-400 text-connector-400",
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* The connector's pane says what signing in does for it in its own words. */}
      {mode !== "connector" && <SignInNotice className="relative mx-3 mt-2 shrink-0" reason="Sign in to use the Copilot." />}
      <div className={cn("relative flex min-h-0 flex-1 flex-col", mode !== "agent" && "hidden")}>
        <AgentPane canEdit={canEdit} onRunning={setAgentRunning} />
      </div>
      <div className={cn("relative flex min-h-0 flex-1 flex-col", mode !== "connector" && "hidden")}>
        <ConnectorPane projectId={projectId} />
      </div>
      <div className={cn("relative flex min-h-0 flex-1 flex-col", mode !== "chat" && "hidden")}>
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
                {openers.map((opener, n) => (
                  <li key={opener}>
                    <button
                      type="button"
                      onClick={() => setDraft(opener)}
                      className="focus-ring lift group flex w-full items-start gap-2.5 rounded-xl border border-line-subtle bg-surface-raised/60 px-3 py-2.5 text-left text-xs leading-relaxed text-text-secondary hover:border-brand-500/40 hover:bg-surface-raised hover:text-text-primary"
                    >
                      <span aria-hidden className="mt-px shrink-0 font-mono text-[10px] text-text-faint transition group-hover:text-brand-400">
                        {String(n + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">{opener}</span>
                      <CornerDownLeft
                        size={12}
                        aria-hidden
                        className="mt-0.5 shrink-0 text-transparent transition group-hover:text-brand-400"
                      />
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

        {/* A shared project's proposals belong to everyone on it (Phase D). */}
        <SharedProposals only={notFromMcp} />

        {chat.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="animate-rise flex justify-end">
              <p className="bubble-user max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2 text-[12.5px] leading-relaxed text-text-primary">
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
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">
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

              {message.steps && message.steps.length > 0 && (
                <details className="group rounded-lg border border-line-subtle bg-surface-raised/30 px-2.5 py-1.5">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary">
                    <ChevronRight size={11} aria-hidden className="transition-transform group-open:rotate-90" />
                    Worked in {message.steps.length} step{message.steps.length === 1 ? "" : "s"}
                    {message.steps.some((s) => s.tool === "render_screen") && <span className="text-text-faint">· looked at the screen</span>}
                  </summary>
                  <ol className="mt-1.5 space-y-1 pb-1">
                    {message.steps.map((step, i) => (
                      <li key={i} className={cn("flex gap-2 font-mono text-[10px] leading-relaxed", step.isError ? "text-status-warn" : "text-text-faint")}>
                        <span className="shrink-0 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                        <span className="min-w-0 break-words">{step.summary}</span>
                      </li>
                    ))}
                  </ol>
                </details>
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

              {message.proposal && (
                <div
                  className={cn(
                    "space-y-2 rounded-lg border p-2.5",
                    message.proposal.status === "pending"
                      ? "border-brand-500/40 bg-brand-500/[0.06]"
                      : "border-line-subtle bg-surface-raised/40",
                  )}
                >
                  <p className="label-eyebrow">
                    {message.proposal.status === "pending"
                      ? message.proposal.deleted
                        ? "Proposal — this deletes something"
                        : "Proposal — not everything could be done"
                      : `Proposal ${message.proposal.status}`}
                  </p>
                  {message.proposal.status === "pending" && (message.proposal.ops?.length ?? 0) > 1 && (
                    <ul className="space-y-1" aria-label="Proposed changes">
                      {message.proposal.ops!.map((label, i) => {
                        const n = message.proposal!.ops!.length;
                        const on = keptFor(message.id, n).includes(i);
                        return (
                          <li key={i}>
                            <label className="flex cursor-pointer gap-2 text-[11px] leading-relaxed text-text-secondary">
                              <input type="checkbox" checked={on} disabled={!canEdit} onChange={() => toggleOp(message.id, n, i)} className="mt-0.5 accent-[var(--color-brand-500)]" />
                              <span className="min-w-0">{label}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {message.proposal.applied.length > 0 && !(message.proposal.status === "pending" && (message.proposal.ops?.length ?? 0) > 1) && (
                    <ul className="space-y-1">
                      {message.proposal.applied.map((line, i) => (
                        <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-text-muted">
                          <Check size={11} aria-hidden strokeWidth={2.5} className="mt-0.5 shrink-0 text-brand-400" />
                          <span className="min-w-0">{line}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {message.proposal.rejected.length > 0 && (
                    <ul className="space-y-1">
                      {message.proposal.rejected.map((line, i) => (
                        <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-status-warn">
                          <AlertTriangle size={11} aria-hidden className="mt-0.5 shrink-0" />
                          <span className="min-w-0">{line}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {message.proposal.status === "pending" && canEdit && (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const n = message.proposal!.ops?.length ?? 0;
                          accept(message.id, n > 1 ? keptFor(message.id, n) : undefined);
                        }}
                        disabled={(message.proposal.ops?.length ?? 0) > 1 && keptFor(message.id, message.proposal.ops!.length).length === 0}
                        className="focus-ring rounded-md btn-primary px-2.5 py-1 text-[11px] font-medium text-text-onbrand transition hover:brightness-110 disabled:opacity-40"
                      >
                        {(message.proposal.ops?.length ?? 0) > 1
                          ? `Apply ${keptFor(message.id, message.proposal.ops!.length).length} of ${message.proposal.ops!.length}`
                          : "Apply what could be done"}
                      </button>
                      <button
                        type="button"
                        onClick={() => discard(message.id)}
                        className="focus-ring rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-hover"
                      >
                        Discard
                      </button>
                    </div>
                  )}
                </div>
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
                      title={
                        message.usage
                          ? `${message.usage.input} in (${message.usage.cached} cached), ${message.usage.output} out`
                          : undefined
                      }
                    >
                      {message.provider}
                      {message.usage && message.usage.input > 0 && (
                        <span className="ml-1 text-text-faint">
                          {Math.round((100 * message.usage.cached) / message.usage.input)}% cached
                        </span>
                      )}
                    </span>
                  )}
                  {message.versionAt && canEdit && (
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

      {/* A read-only project has no composer, only a line saying why. */}
      {!canEdit && (
        <p className="relative mx-3 mb-3 shrink-0 rounded-xl border border-line-subtle bg-surface-raised/60 px-3 py-2.5 text-[11px] text-text-muted">
          View only — ask an editor for changes.
        </p>
      )}

      {/* The composer, pinned to the foot of the same column. */}
      {canEdit && (
        <div className="relative shrink-0 p-3 pt-2">
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
              "composer beam-border relative rounded-2xl border bg-surface-raised transition",
              working ? "border-brand-500/40" : "border-line",
            )}
            style={working ? { boxShadow: "var(--glow-brand)" } : undefined}
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
                "focus-ring press absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg",
                draft.trim() && !working
                  ? "btn-primary text-text-onbrand hover:brightness-110"
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
            <kbd className="kbd">Enter</kbd> to send
            {" · "}
            <kbd className="kbd">Shift</kbd>+
            <kbd className="kbd">Enter</kbd> for a new
            line
          </p>
        </div>
      )}
      </div>
    </aside>
  );
}
