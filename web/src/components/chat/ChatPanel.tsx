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
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Info,
  Loader,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useProject } from "@/store/project";
import { Badge, Button, Textarea, cn } from "@/components/ui";
import { anythingMissing, requirementsOf } from "./requirements";
import { useChat } from "./useChat";

const MAX_INTENT = 600;

/** Openers that show what this can be asked for, not what it can be told. */
const OPENERS = [
  "Create a pump station screen for the two transfer pumps",
  "Add a plant overview above the screens I have",
  "Move the flow reading clear of the alarm banner",
  "Add a high-level alarm on the tank",
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
  const restore = useProject((s) => s.restore);

  const { send } = useChat();
  const thread = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const requirements = useMemo(
    () => requirementsOf({ variables, screens, alarms, target }),
    [variables, screens, alarms, target],
  );
  const missing = anythingMissing(requirements);
  const working = chat.some((m) => m.pending) || generating;

  /** Follow the tail, but release the moment the engineer scrolls up. */
  useEffect(() => {
    const el = thread.current;
    if (!el || !pinned.current) return;
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
    <aside className="flex h-full w-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
        <Sparkles size={13} aria-hidden className="text-brand-400" />
        <h2 className="text-xs font-semibold text-text-primary">Copilot</h2>
        {chat.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            title="Clear the conversation. The screens stay."
            className="focus-ring ml-auto rounded p-1 text-text-faint transition hover:text-text-secondary"
            aria-label="Clear the conversation"
          >
            <Trash2 size={12} aria-hidden />
          </button>
        )}
      </div>

      {/* The thread. Takes whatever height is left and scrolls on its own. */}
      <div
        ref={thread}
        onScroll={() => {
          const el = thread.current;
          if (!el) return;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        aria-live="polite"
        aria-label="Conversation"
      >
        {chat.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-text-muted">
              Describe what you need and keep going until it is right. Every turn
              edits the project you can see, and every turn can be undone.
            </p>

            <ul className="space-y-1">
              {OPENERS.map((opener) => (
                <li key={opener}>
                  <button
                    type="button"
                    onClick={() => setDraft(opener)}
                    className="focus-ring w-full rounded-md border border-line-subtle px-2.5 py-1.5 text-left text-[11px] leading-snug text-text-secondary transition hover:border-brand-400 hover:text-brand-400"
                  >
                    {opener}
                  </button>
                </li>
              ))}
            </ul>

            <div className="rounded-md border border-line-subtle p-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
                <Info size={11} aria-hidden />
                What a request needs
              </p>
              <ul className="space-y-1.5">
                {requirements.map((r) => (
                  <li key={r.id} className="flex gap-1.5 text-[11px] leading-snug">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 shrink-0",
                        r.met ? "text-status-ok" : "text-text-faint",
                      )}
                    >
                      {r.met ? <Check size={11} /> : "·"}
                    </span>
                    <span className="min-w-0">
                      <span className="text-text-secondary">{r.label}</span>
                      <span className="block text-text-faint">{r.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {chat.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <p className="max-w-[92%] rounded-lg rounded-br-sm bg-brand-500/12 px-2.5 py-1.5 text-xs leading-relaxed text-text-primary">
                {message.text}
              </p>
            </div>
          ) : (
            <div key={message.id} className="space-y-1.5">
              {message.pending && !message.text ? (
                <p className="flex items-center gap-2 text-xs text-text-faint">
                  <Loader size={12} className="animate-spin" aria-hidden />
                  Reading the request
                </p>
              ) : (
                message.text && (
                  <p className="text-xs leading-relaxed text-text-secondary">
                    {message.text}
                  </p>
                )
              )}

              {message.questions && message.questions.length > 0 && (
                <ul className="space-y-1">
                  {message.questions.map((question) => (
                    <li key={question}>
                      <button
                        type="button"
                        onClick={() => setDraft(question)}
                        title="Put this in the box to answer it"
                        className="focus-ring w-full rounded-md border border-status-info/40 bg-status-info/5 px-2.5 py-1.5 text-left text-[11px] leading-snug text-status-info transition hover:border-status-info"
                      >
                        {question}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {message.changes && message.changes.length > 0 && (
                <ul className="space-y-0.5 border-l-2 border-brand-500/40 pl-2">
                  {message.changes.map((change, i) => (
                    <li key={i} className="font-mono text-[10px] leading-relaxed text-text-muted">
                      {change}
                    </li>
                  ))}
                </ul>
              )}

              {message.error && (
                <p className="flex gap-1.5 rounded-md border border-status-warn/40 bg-status-warn/10 px-2 py-1.5 text-[10px] leading-snug text-status-warn">
                  <AlertTriangle size={11} aria-hidden className="mt-0.5 shrink-0" />
                  {message.error}
                </p>
              )}

              {(message.versionAt || message.provider) && !message.pending && (
                <div className="flex items-center gap-2">
                  {message.provider && (
                    <Badge tone={message.provider === "local" ? "warn" : "neutral"}>
                      {message.provider}
                    </Badge>
                  )}
                  {message.versionAt && (
                    <button
                      type="button"
                      onClick={() => restore(message.versionAt!)}
                      title="Put the project back the way this turn left it"
                      className="focus-ring inline-flex items-center gap-1 rounded text-[10px] text-text-faint transition hover:text-brand-400"
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
      <div className="shrink-0 space-y-2 border-t border-line-subtle p-3">
        {missing && chat.length > 0 && (
          <p className="text-[10px] leading-snug text-text-faint">
            {requirements
              .filter((r) => r.id !== "subject" && !r.met)
              .map((r) => r.detail)
              .join(" ")}
          </p>
        )}

        <div className="relative">
          <Textarea
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
              screens.length === 0
                ? "Create a pump station screen for the two transfer pumps…"
                : "Ask for a change, or another screen…"
            }
            className="pr-11"
          />
          <Button
            variant="primary"
            size="sm"
            iconOnly
            className="absolute bottom-2 right-2"
            disabled={!draft.trim() || working}
            onClick={submit}
            aria-label="Send"
            title="Send (Enter)"
            icon={working ? <Loader size={14} className="animate-spin" /> : <ArrowUp size={14} />}
          />
        </div>
      </div>
    </aside>
  );
}
