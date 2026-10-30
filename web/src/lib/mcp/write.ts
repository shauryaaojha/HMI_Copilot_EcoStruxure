/**
 * The write tools: M2 of phase 4.
 *
 * Both of them speak the `Op` union and both run it through `core/ops`. There
 * is no second applier here and there must never be: one write path is what
 * gives the project one undo history, one collaboration stream and one place
 * to check a change before it lands (`core/ops/index.ts`). `dryRunOnSnapshot`
 * is the server's entry to it - the same function the chat panel's proposals
 * go through - and `live.append` is the same change log a browser's edits
 * travel on, so a connector change and a mouse change cannot disagree about
 * revisions or conflicts.
 *
 * The default is a proposal. Shaurya asked for "full control", and the repo
 * already had a better answer to that: an AI change arrives for an editor to
 * accept, and the decision is logged with their name for the sign-off report
 * (docs/RESEARCH_CLAUDE_AI_INTEGRATION.md, "the main decision"). A project can
 * be opted in to direct writes one at a time, by someone who may manage it.
 * `apply_ops` on a project that has not opted in does not fail - it proposes,
 * and says so - because the useful answer to "I cannot write" is the change
 * sitting in the queue, not an error.
 *
 * Nothing here reads a tag comment, a screen name or any other project text to
 * decide what to do. The ops are the arguments the caller passed, and only
 * those.
 */
import { z } from "zod";
import { Op } from "@/core/ops";
import { dryRunOnSnapshot } from "@/lib/collab/proposal";
import type { OpOutcome } from "@/core/ops";
import { repo } from "@/lib/server/repo";
import { ServerError } from "@/lib/server/errors";
import { agentAuthor, proposeEdit } from "@/lib/server/proposals";
import { callerUser } from "./caller";
import { field, limited, projectData, RESULT_LIMIT } from "./data";
import { directWrites, openProject } from "./project";
import { refusal } from "./result";
import { tool, type McpTool } from "./spec";

/** The same ceiling `lib/server/proposals.ts` puts on one turn's ops. */
const Ops = z.array(Op).max(200);

/** Project text inside a report - names, rejection reasons - stays fenced. */
function reportLines(outcome: Pick<OpOutcome, "applied" | "rejected" | "created" | "renamed">): string[] {
  const lines: string[] = [];
  for (const line of outcome.applied) lines.push(`done: ${field(line, 300)}`);
  for (const { op, reason } of outcome.rejected) lines.push(`refused: ${field(op.op, 40)} ${field(op.target ?? op.name ?? op.equipment ?? "", 120)} - ${field(reason, 400)}`);
  for (const c of outcome.created) lines.push(`created: ${field(c.handle, 20)} ${field(c.name, 120)} (${field(c.type, 40)}) on ${field(c.screen, 120)}`);
  for (const r of outcome.renamed) lines.push(`renamed: asked "${field(r.asked, 120)}", became "${field(r.became, 120)}" (${field(r.handle, 20)})`);
  return lines;
}

/**
 * The proposal path, which is also what `apply_ops` falls back to. Goes
 * through `proposeEdit`, so the role check, the dry run and the queue are the
 * project's existing ones rather than anything this module invented.
 */
async function queue(caller: Parameters<typeof callerUser>[0], projectId: string, ops: z.infer<typeof Ops>, note: string, screenId?: string, preamble?: string) {
  const proposal = await proposeEdit(callerUser(caller), projectId, { ops, request: note, ...(screenId ? { screenId } : {}) });
  const lines = [
    ...proposal.labels.map((l) => `waiting: ${field(l, 300)}`),
    ...proposal.rejected.map((r) => `could not be done: ${field(r, 400)}`),
  ];
  return {
    text: [
      preamble ?? "",
      `Queued as proposal ${proposal._id} for an editor to accept. Nothing in the project has changed yet; ${proposal.labels.length} change(s) are waiting and the decision will be logged with the name of whoever makes it.`,
      projectData("proposal", limited(lines, RESULT_LIMIT - 2_000)),
    ].filter(Boolean).join("\n"),
    structured: { mode: "proposal", proposalId: proposal._id, waiting: proposal.labels.length, rejected: proposal.rejected.length },
  };
}

const applyOpsTool = tool({
  name: "apply_ops",
  title: "Apply ops",
  description:
    "Changes a project with a list of ops - add, move, resize, rename, set text or colour, bind a tag, delete, align, tidy. Ops are dry-run first and the report says exactly what landed and what was refused. On most projects the change is queued as a proposal for a human editor to accept; a project whose owner has turned on direct writes is changed straight away. Pass confirm: true only after the engineer has agreed, and only when a previous call said it was needed.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  input: {
    projectId: z.string().describe("The project id, from list_projects."),
    ops: Ops.describe("The ops to apply, in order."),
    screenId: z.string().optional().describe("Screen handle the ops default to, from get_screens."),
    note: z.string().max(2000).optional().describe("One line, in engineering language, saying what this change is for."),
    confirm: z.boolean().optional().describe("Must be true to delete anything, or to write directly into a project that was opened from a customer's file."),
  },
  async run({ projectId, ops, screenId, note, confirm }, { caller }) {
    const { project, rev, doc } = await openProject(caller, projectId, "edit");
    const what = note ?? "Change asked for through the claude.ai connector";
    if (!directWrites(project)) {
      return queue(caller, projectId, ops, what, screenId, "This project has not been opted in to direct writes, so the change was not applied.");
    }

    const run = dryRunOnSnapshot(doc, ops, screenId);
    // A project opened from a customer's .eote is exported back into that same
    // file, so a change made here without being asked for would eventually
    // overwrite somebody's original. Deletions get the same bar for the
    // obvious reason: the dry run is the only chance to see them first.
    const opened = !!doc.source || !!doc.sourceId;
    if ((run.outcome.deleted || opened) && confirm !== true) {
      const why = run.outcome.deleted
        ? "these ops delete something"
        : "this project was opened from a customer's file and is exported back into it";
      return {
        ...refusal(
          [
            `Not applied: ${why}, so it needs the engineer's explicit agreement. This is what it would have done - show it to them, and call apply_ops again with confirm: true only if they agree.`,
            projectData("dry run", limited(reportLines(run.outcome), RESULT_LIMIT - 2_000)),
          ].join("\n"),
          "needs-confirm",
        ),
        structured: { mode: "dry-run", needsConfirm: true, reason: run.outcome.deleted ? "deletes" : "opened-file", applied: run.outcome.applied.length, rejected: run.outcome.rejected.length },
      };
    }

    if (run.changes.length === 0) {
      return {
        text: ["Nothing changed.", projectData("dry run", limited(reportLines(run.outcome), RESULT_LIMIT - 2_000))].join("\n"),
        structured: { mode: "direct", rev, applied: 0, rejected: run.outcome.rejected.length },
      };
    }

    // Authored by the agent and accepted by the caller: the opt-in is a
    // standing acceptance, and the change log already has a place to record
    // both, so the sign-off report still shows an AI change with a human's
    // name against it.
    const result = await repo().live.append(projectId, [
      { id: crypto.randomUUID(), base: rev, author: agentAuthor(), ops: run.changes, acceptedBy: caller.userId },
    ]);
    if (result.rejected.length > 0) {
      throw new ServerError(409, "stale", `The project changed while this was being worked out (${result.rejected[0].reason}); read it again and ask again`);
    }
    return {
      text: [
        `Applied to "${field(project.name, 120)}" as revision ${result.rev}. Direct writes are on for this project, so no editor had to accept it.`,
        projectData("report", limited(reportLines(run.outcome), RESULT_LIMIT - 2_000)),
      ].join("\n"),
      structured: { mode: "direct", rev: result.rev, applied: run.outcome.applied.length, rejected: run.outcome.rejected.length, deleted: run.outcome.deleted },
    };
  },
});

const proposeTool = tool({
  name: "propose",
  title: "Propose a change",
  description:
    "Puts a list of ops in the project's proposal queue for a human editor to accept or discard, change by change, instead of applying them. Use this when the engineer should look before the project changes - and on a project where apply_ops says direct writes are off, this is what apply_ops does anyway.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  input: {
    projectId: z.string().describe("The project id, from list_projects."),
    ops: Ops.describe("The ops to propose, in order."),
    note: z.string().min(1).max(2000).describe("One line saying what this change is for; the editor sees it beside the proposal."),
    screenId: z.string().optional().describe("Screen handle the ops default to, from get_screens."),
  },
  async run({ projectId, ops, note, screenId }, { caller }) {
    // `proposeEdit` makes the same "edit" check through access.ts, but asking
    // first means a caller who may only read is told so before a dry run.
    await openProject(caller, projectId, "edit");
    return queue(caller, projectId, ops, note, screenId);
  },
});

export const WRITE_TOOLS: readonly McpTool[] = [applyOpsTool, proposeTool];
