"use client";

/**
 * One turn of the conversation, start to finish.
 *
 * The engineer keeps asking until the screens are right, so a turn is a request
 * against the project *as it stands* - not a fresh generation. What the turn
 * decided (clarify, build, edit, answer) and what it changed are both recorded
 * on the assistant's message, so the conversation doubles as the build log and
 * a version can be jumped back to from the turn that produced it.
 *
 * Two paths lead out of here. A "build" runs the eight-step pipeline, which
 * streams and fills the canvas object by object - that is the demo. An "edit"
 * applies a list of ops through the same store actions the toolbar uses, so it
 * lands in the same undo history.
 */

import { useCallback, useRef } from "react";
import { digestOf } from "@/lib/ai/converse";
import type { Turn } from "@/lib/ai/ops";
import { useProject } from "@/store/project";
import type { ChatMessage } from "@/store/types";
import { useGeneration } from "@/components/generation/useGeneration";
import { applyOps } from "./applyOps";

/** Enough turns for the assistant to follow a thread, few enough to stay cheap. */
const HISTORY_TURNS = 12;

const id = () => crypto.randomUUID();

export function useChat() {
  const { generate } = useGeneration();
  const busy = useRef(false);

  const send = useCallback(
    async (text: string) => {
      const request = text.trim();
      if (!request || busy.current) return;
      busy.current = true;

      const store = useProject.getState();
      const question: ChatMessage = {
        id: id(),
        role: "user",
        at: Date.now(),
        text: request,
      };
      const answerId = id();
      store.addMessage(question);
      store.addMessage({
        id: answerId,
        role: "assistant",
        at: Date.now(),
        text: "",
        pending: true,
      });

      const patch = (p: Partial<ChatMessage>) =>
        useProject.getState().patchMessage(answerId, p);

      try {
        const s = useProject.getState();
        const history = s.chat
          .filter((m) => !m.pending && m.text.trim())
          .slice(-HISTORY_TURNS)
          .map((m) => ({ role: m.role, text: m.text }));

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            history,
            digest: digestOf({
              name: s.name,
              target: s.target,
              screens: s.screens,
              activeScreenId: s.activeScreenId,
              variables: s.variables,
              alarms: s.alarms,
              bindings: s.bindings,
              selectedIds: s.selectedIds,
            }),
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? `the chat route answered ${response.status}`);
        }

        const body = (await response.json()) as { provider: string | null; turn: Turn };
        const turn = body.turn;
        patch({ text: turn.reply, provider: body.provider ?? "local" });

        if (turn.mode === "clarify") {
          patch({ pending: false, questions: turn.questions ?? [] });
          return;
        }

        if (turn.mode === "build") {
          // The pipeline infers equipment from tag names, so with no tags there
          // is nothing to lay out. It would fail at the first step and leave a
          // red line in the log; saying it here, once, is the better answer.
          if (useProject.getState().variables.length === 0) {
            patch({
              pending: false,
              text:
                "There are no PLC tags in this project yet, and equipment is " +
                "inferred from tag names — so there is nothing to lay out. " +
                "Import a tag export, or load the sample list, and ask again. " +
                "You can still draw and ask for individual objects meanwhile.",
            });
            return;
          }

          const before = useProject.getState().screens.length;
          // Append rather than replace: an HMI application is several screens,
          // and the second request must not erase the first.
          await generate(turn.buildIntent || request, { fresh: before === 0 });

          const after = useProject.getState();
          const screen = after.screens.at(-1);
          const objects = screen?.Children[0].Children.length ?? 0;
          const versionAt = after.snapshot(
            `Built ${screen?.Name ?? "a screen"} — ${objects} objects`,
          );
          patch({
            pending: false,
            versionAt,
            changes: [
              `${after.screens.length > before ? "Added" : "Rebuilt"} ${screen?.Name ?? "a screen"} — ${objects} objects`,
              `${after.alarms.length} alarms, ${after.bindings.length} bindings`,
            ],
          });
          return;
        }

        if (turn.mode === "edit" && turn.ops && turn.ops.length > 0) {
          const { changes, problems } = applyOps(turn.ops);
          const after = useProject.getState();
          const versionAt =
            changes.length > 0
              ? after.snapshot(changes[0].slice(0, 60))
              : undefined;
          for (const line of changes) after.log(line);
          patch({
            pending: false,
            changes,
            versionAt,
            error: problems.length > 0 ? problems.join(" ") : undefined,
          });
          return;
        }

        patch({ pending: false });
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "the turn could not be completed";
        patch({
          pending: false,
          text: "",
          error: message,
        });
      } finally {
        busy.current = false;
      }
    },
    [generate],
  );

  /** A clarifying question answered by clicking it is still a turn. */
  const answer = useCallback((text: string) => void send(text), [send]);

  return { send, answer };
}
