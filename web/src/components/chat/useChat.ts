"use client";

/**
 * One turn of the conversation, start to finish.
 *
 * The engineer keeps asking until the screens are right, so a turn is a request
 * against the project *as it stands* - not a fresh generation. What the turn
 * decided and what it changed are recorded on the assistant's message as a
 * structured record, and that record - not the sentence - is what the model
 * sees as its own history next time (docs/LLD.md F4).
 *
 * An "edit" never touches the live project directly. Its ops run on a scratch
 * store; if anything was rejected the model gets one repair pass with the
 * reasons; then the result either commits as one undo step or waits as a
 * proposal for the engineer to accept (F7). A "build" is only allowed on an
 * empty project; on one with screens it becomes "extend", which plans around
 * what exists (F5).
 */

import { useCallback, useRef } from "react";
import { describeOp, digestOf, type HistoryItem } from "@/lib/ai/converse";
import { isUnnamed, nameProject } from "@/lib/ai/name";
import type { Turn } from "@/lib/ai/ops";
import { inferEquipment } from "@/lib/ai/infer";
import type { ExistingScreen } from "@/lib/ai/pipeline";
import { commit, dryRun, previewOf, type DryRun, type OpOutcome } from "@/lib/ai/applier";
import { useProject } from "@/store/project";
import type { ChatMessage } from "@/store/types";
import { loadProjects, touchProject } from "@/store/projects";
import { useGeneration } from "@/components/generation/useGeneration";

/** Exchanges sent verbatim; older ones become one anchor line server-side. */
const HISTORY_MESSAGES = 24;

const START_OVER = "Yes, start over and discard the current screens";

const id = () => crypto.randomUUID();

/**
 * Dry runs waiting for a decision, by message id. In memory only: a proposal
 * that does not survive a reload is shown as expired rather than applied to
 * a project that has moved on.
 */
const pending = new Map<string, DryRun>();

const cardKey = (unitId: string) => unitId.replace(/[^A-Za-z0-9]/g, "");

/** The screens the application has, as the pipeline needs them for an extension. */
function existingScreens(): ExistingScreen[] {
  const s = useProject.getState();
  const equipment = inferEquipment(s.variables);
  return s.screens.map((screen) => {
    const names = new Set(screen.Children[0].Children.map((p) => p.Name));
    const include = equipment
      .filter((u) => names.has(`Card_${cardKey(u.id)}`) || names.has(`Tile_${cardKey(u.id)}`))
      .map((u) => u.id);
    const isTiles = equipment.some((u) => names.has(`Tile_${cardKey(u.id)}`));
    return { name: screen.Name, level: isTiles ? 1 : 2, include };
  });
}

function recordOf(mode: Turn["mode"], outcome: OpOutcome): NonNullable<ChatMessage["turn"]> {
  return {
    mode,
    applied: outcome.applied,
    rejected: outcome.rejected.map((r) => ({ op: describeOp(r.op), reason: r.reason })),
    renamed: outcome.renamed,
  };
}

export function useChat() {
  const { generate } = useGeneration();
  const busy = useRef(false);
  const awaitingStartOver = useRef<string | null>(null);

  const nameIfUnnamed = useCallback((request: string, suggested?: string) => {
    const s = useProject.getState();
    if (!isUnnamed(s.name)) return;
    const name = nameProject({
      suggested,
      intent: request,
      screens: s.screens.map((screen) => screen.Name),
      kinds: s.equipment.map((unit) => unit.kind),
      taken: new Set(loadProjects().map((p) => p.name)),
    });
    if (!name) return;
    s.rename(name);
    touchProject(s.id, { name });
    s.log(`Project named ${name}`);
  }, []);

  /** Calls the route once. Throws on a transport failure. */
  const ask = useCallback(async (history: HistoryItem[], request: string, repair: boolean) => {
    const s = useProject.getState();
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        history,
        repair,
        // What the lookup tools can search. Compact, never in the prompt.
        catalog: {
          tags: s.variables.map((v) => ({ name: v.Name, dataType: v.DataType, comment: v.Comments ?? "" })),
          objects: s.screens.flatMap((screen) =>
            screen.Children[0].Children.map((p) => ({
              handle: s.handles[p.UniqueId] ?? "?",
              name: p.Name,
              type: p.Type,
              screen: s.handles[screen.UniqueId] ?? screen.Name,
              tag: s.bindings.find((b) => b.targetId === p.UniqueId)?.tag,
            })),
          ),
        },
        digest: digestOf(
          {
            name: s.name,
            target: s.target,
            screens: s.screens,
            activeScreenId: s.activeScreenId,
            variables: s.variables,
            alarms: s.alarms,
            bindings: s.bindings,
            selectedIds: s.selectedIds,
            handles: s.handles,
          },
          request,
        ),
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `the chat route answered ${response.status}`);
    }
    return (await response.json()) as {
      provider: string | null;
      model: string | null;
      turn: Turn;
      usage?: ChatMessage["usage"];
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      const request = text.trim();
      if (!request || busy.current) return;
      busy.current = true;

      const store = useProject.getState();
      // A new request supersedes any proposal still waiting; its dry run was
      // against a project that is about to be asked something else.
      if (store.preview) {
        pending.delete(store.preview.messageId);
        const stale = store.chat.find((m) => m.id === store.preview?.messageId);
        if (stale?.proposal?.status === "pending") {
          store.patchMessage(stale.id, { proposal: { ...stale.proposal, status: "expired" } });
        }
        store.setPreview(undefined);
      }
      const question: ChatMessage = { id: id(), role: "user", at: Date.now(), text: request };
      const answerId = id();
      store.addMessage(question);
      store.addMessage({ id: answerId, role: "assistant", at: Date.now(), text: "", pending: true });

      const patch = (p: Partial<ChatMessage>) => useProject.getState().patchMessage(answerId, p);

      const runGeneration = async (intent: string, fresh: boolean, suggestedName?: string) => {
        const before = useProject.getState().screens.length;
        await generate(intent, fresh ? { fresh: true } : { fresh: false, existing: existingScreens() });
        // The older screens' strips do not know about the new screens yet.
        if (!fresh) useProject.getState().refreshNavigation();
        nameIfUnnamed(intent, suggestedName);
        const after = useProject.getState();
        const added = after.screens.slice(fresh ? 0 : before);
        const objects = added.reduce((n, s) => n + s.Children[0].Children.length, 0);
        const label = added.length
          ? `${fresh ? "Built" : "Added"} ${added.map((s) => s.Name).join(", ")} — ${objects} objects`
          : "Nothing was added";
        const versionAt = added.length ? after.snapshot(label) : undefined;
        patch({
          pending: false,
          versionAt,
          changes: [label, `${after.alarms.length} alarms, ${after.bindings.length} bindings`],
          turn: { mode: fresh ? "build" : "extend", applied: [label], rejected: [], renamed: [], decision: "committed" },
        });
      };

      try {
        // The confirmation for a start-over is a turn like any other, but it
        // does not need the model: the question was ours.
        if (awaitingStartOver.current && request === START_OVER) {
          const intent = awaitingStartOver.current;
          awaitingStartOver.current = null;
          patch({ text: "Starting over.", provider: "local" });
          await runGeneration(intent, true);
          return;
        }
        awaitingStartOver.current = null;

        const s = useProject.getState();
        const history: HistoryItem[] = s.chat
          .filter((m) => !m.pending && (m.text.trim() || m.turn))
          .slice(-HISTORY_MESSAGES)
          .map((m) =>
            m.role === "user"
              ? { role: "user", text: m.text }
              : { role: "assistant", text: m.text, turn: m.turn },
          );

        const first = await ask(history, request, false);
        let turn = first.turn;
        patch({ text: turn.reply, provider: first.provider ?? "local", usage: first.usage });

        if (turn.mode === "clarify") {
          nameIfUnnamed(request, turn.projectName);
          patch({ pending: false, questions: turn.questions ?? [], turn: { mode: "clarify", applied: [], rejected: [], renamed: [] } });
          return;
        }

        if (turn.mode === "answer") {
          nameIfUnnamed(request, turn.projectName);
          patch({ pending: false, turn: { mode: "answer", applied: [], rejected: [], renamed: [] } });
          return;
        }

        if (turn.mode === "startOver") {
          awaitingStartOver.current = turn.buildIntent || request;
          const n = useProject.getState().screens.length;
          patch({
            pending: false,
            text: turn.reply || `This discards ${n} screen${n === 1 ? "" : "s"} and their bindings.`,
            questions: [START_OVER],
            turn: { mode: "startOver", applied: [], rejected: [], renamed: [] },
          });
          return;
        }

        if (turn.mode === "build" || turn.mode === "extend") {
          if (useProject.getState().variables.length === 0) {
            patch({
              pending: false,
              text:
                "There are no PLC tags in this project yet, and equipment is inferred from " +
                "tag names — so there is nothing to lay out. Import a tag export, or load the " +
                "sample list, and ask again.",
              turn: { mode: turn.mode, applied: [], rejected: [{ op: "build", reason: "no tags" }], renamed: [] },
            });
            return;
          }
          // A build on a project that already has content is an extension,
          // whatever the model called it. The second plant is how the
          // duplicates happened.
          const hasContent = useProject.getState().screens.some((x) => x.Children[0].Children.length > 0);
          await runGeneration(turn.buildIntent || request, !hasContent, turn.projectName);
          return;
        }

        // --- edit: dry run, one repair, then commit or propose --------------
        let ops = turn.ops ?? [];
        let run = dryRun(ops);
        let repaired = false;

        if (run.outcome.rejected.length > 0 && ops.length > 0) {
          const record = recordOf("edit", run.outcome);
          const second = await ask(
            [...history, { role: "user", text: request }, { role: "assistant", text: turn.reply, turn: record }],
            request,
            true,
          );
          if (second.turn.mode === "edit" && second.turn.ops && second.turn.ops.length > 0) {
            turn = second.turn;
            ops = second.turn.ops;
            run = dryRun(ops);
            repaired = true;
            patch({ text: turn.reply, usage: second.usage });
          } else if (second.turn.mode === "answer") {
            // The model says it cannot be done. Show its reason with the
            // rejections; nothing changes.
            nameIfUnnamed(request, turn.projectName);
            patch({
              pending: false,
              text: second.turn.reply,
              error: run.outcome.problems.join(" "),
              turn: { ...record, decision: "discarded" },
            });
            return;
          }
        }

        nameIfUnnamed(request, turn.projectName);
        const record = recordOf("edit", run.outcome);

        if (ops.length === 0) {
          patch({ pending: false, turn: record });
          return;
        }

        const clean = run.outcome.rejected.length === 0 && !run.outcome.deleted;
        if (clean) {
          commit(run, run.outcome.applied[0]?.slice(0, 60) || "Conversational edit");
          const after = useProject.getState();
          for (const line of run.outcome.applied) after.log(line);
          const versionAt = after.snapshot(run.outcome.applied[0]?.slice(0, 60) || "Edit");
          patch({
            pending: false,
            changes: run.outcome.applied,
            versionAt,
            turn: { ...record, decision: "committed" },
          });
          return;
        }

        // Something was rejected even after repair, or something would be
        // deleted: the engineer decides, looking at ghosts on the canvas.
        pending.set(answerId, run);
        useProject.getState().setPreview({ messageId: answerId, screens: previewOf(run) });
        patch({
          pending: false,
          turn: { ...record, decision: "proposed" },
          proposal: {
            status: "pending",
            applied: run.outcome.applied,
            rejected: run.outcome.problems,
            deleted: run.outcome.deleted,
          },
          error: repaired && run.outcome.rejected.length > 0 ? "Still could not do everything after one repair pass." : undefined,
        });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "the turn could not be completed";
        patch({ pending: false, text: "", error: message });
      } finally {
        busy.current = false;
      }
    },
    [ask, generate, nameIfUnnamed],
  );

  /** A clarifying question answered by clicking it is still a turn. */
  const answer = useCallback((text: string) => void send(text), [send]);

  const accept = useCallback((messageId: string) => {
    const run = pending.get(messageId);
    const s = useProject.getState();
    const message = s.chat.find((m) => m.id === messageId);
    if (!message?.proposal) return;
    if (!run) {
      s.patchMessage(messageId, { proposal: { ...message.proposal, status: "expired" } });
      return;
    }
    pending.delete(messageId);
    s.setPreview(undefined);
    commit(run, run.outcome.applied[0]?.slice(0, 60) || "Accepted proposal");
    const after = useProject.getState();
    for (const line of run.outcome.applied) after.log(line);
    const versionAt = after.snapshot(run.outcome.applied[0]?.slice(0, 60) || "Accepted proposal");
    after.patchMessage(messageId, {
      proposal: { ...message.proposal, status: "accepted" },
      changes: run.outcome.applied,
      versionAt,
      turn: message.turn ? { ...message.turn, decision: "accepted" } : undefined,
    });
  }, []);

  const discard = useCallback((messageId: string) => {
    pending.delete(messageId);
    const s = useProject.getState();
    if (s.preview?.messageId === messageId) s.setPreview(undefined);
    const message = s.chat.find((m) => m.id === messageId);
    if (!message?.proposal) return;
    s.patchMessage(messageId, {
      proposal: { ...message.proposal, status: "discarded" },
      turn: message.turn ? { ...message.turn, decision: "discarded" } : undefined,
    });
  }, []);

  return { send, answer, accept, discard };
}
