/**
 * The write tools: M2 of phase 4, and the one landing every tool shares.
 *
 * Both tools speak the `Op` union and both run it through `core/ops`. There
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
 * `land` is that rule as a function, so there is exactly one place where the
 * opt-in is read. M3's generation job calls it too (`generate.ts`): a job is a
 * slower caller, not a privileged one, and a build on a project that has not
 * opted in queues for an editor like every other change. A job that wrote
 * through anything else would be the second write path this file exists to
 * prevent.
 *
 * Nothing here reads a tag comment, a screen name or any other project text to
 * decide what to do. The ops are the arguments the caller passed, and only
 * those.
 */
import { z } from "zod";
import { Op } from "@/core/ops";
import { diff } from "@/lib/collab/changes";
import { dryRunOnSnapshot, type SnapshotRun } from "@/lib/collab/proposal";
import type { OpOutcome } from "@/core/ops";
import type { Doc, StoreChange } from "@/lib/collab/types";
import type { Variable } from "@/lib/ote/schema";
import { repo } from "@/lib/server/repo";
import { ServerError } from "@/lib/server/errors";
import { agentAuthor, proposeAgentRun, proposeEdit } from "@/lib/server/proposals";
import type { TagImport } from "@/store/types";
import { callerUser, type Caller } from "./caller";
import { field, limited, projectData, RESULT_LIMIT } from "./data";
import { directWrites, openProject } from "./project";
import { refusal, type ToolOutput } from "./result";
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
async function queue(caller: Caller, projectId: string, ops: z.infer<typeof Ops>, note: string, screenId?: string, preamble?: string) {
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
    landed: { mode: "proposal" as const, proposalId: proposal._id, lines, applied: proposal.labels.length, rejected: proposal.rejected.length },
  };
}

/**
 * Tags a confirmed plant brief produced, carried into the landing beside the
 * ops that draw them.
 *
 * There is no op for importing a tag list, and inventing one for a job would
 * be a worse answer than this: a brief's placeholder tags are not an edit
 * somebody might want to replay, they are the ground the ops stand on -
 * `addEquipment` re-infers equipment from the project's own variables
 * (`core/ops/apply.ts`), so the tags have to be in the document the dry run
 * reads or every faceplate op would be refused. They travel inside the same
 * one change, so the tags and the screens that show them land together or not
 * at all.
 */
export interface SeedTags {
  variables: Variable[];
  tagImport: TagImport;
}

/** What landed, for a caller that records the facts rather than relaying text. */
export interface LandedOutcome {
  mode: "proposal" | "direct" | "nothing" | "refused";
  proposalId?: string;
  rev?: number;
  /** The dry run's report, one line per op, each field already fenced-safe. */
  lines: string[];
  applied: number;
  rejected: number;
}

/** A tool answer, plus the same answer as facts. */
export interface Landed extends ToolOutput {
  landed: LandedOutcome;
}

export interface Landing {
  ops: z.infer<typeof Ops>;
  /** One line, in engineering language, saying what the change is for. */
  note: string;
  screenId?: string;
  seed?: SeedTags;
  /** The engineer's explicit agreement to a delete, or to touching their file. */
  confirm?: boolean;
  /** A sentence before the report, when the caller has something to add. */
  preamble?: string;
  /**
   * The one label a seeded proposal carries. Only read when `seed` is set,
   * because only then is the proposal a document rather than a list of ops.
   */
  label?: string;
}

/** The document the dry run reads: the project, plus any seeded tags. */
function seededDoc(doc: Doc, seed?: SeedTags): Doc {
  if (!seed) return doc;
  return { ...doc, variables: seed.variables, tagImport: seed.tagImport };
}

/**
 * The whole change: the seeded tags, then what the ops did to the document
 * holding them. Two diffs composed rather than one, because the tags are not
 * an op's work and the dry run deliberately starts from a document that
 * already has them. `StoreChange` records carry whole values, so the second
 * diff applied after the first gives exactly what it was computed against.
 */
function changesFor(doc: Doc, seed: SeedTags | undefined, run: SnapshotRun): StoreChange[] {
  if (!seed) return run.changes;
  return [...diff(doc, seededDoc(doc, seed)), ...run.changes];
}

/**
 * A build queued as one decision. The ops are not kept for replay: a generated
 * application is a document the engineer looked at, and accepting half of it
 * would land screens whose navigation strip names screens that were not
 * accepted.
 */
async function queueBuild(caller: Caller, projectId: string, landing: Landing, run: SnapshotRun, changes: StoreChange[], preamble: string): Promise<Landed> {
  const proposal = await proposeAgentRun(callerUser(caller), projectId, {
    request: landing.note,
    label: landing.label ?? landing.note,
    changes,
    rejected: run.outcome.problems,
  });
  const lines = reportLines(run.outcome);
  return {
    text: [
      preamble,
      `Queued as proposal ${proposal._id} for an editor to accept. Nothing in the project has changed yet, and the decision will be logged with the name of whoever makes it.`,
      projectData("proposal", limited(lines, RESULT_LIMIT - 2_000)),
    ].join("\n"),
    structured: { mode: "proposal", proposalId: proposal._id, waiting: proposal.labels.length, rejected: run.outcome.rejected.length },
    landed: { mode: "proposal", proposalId: proposal._id, lines, applied: run.outcome.applied.length, rejected: run.outcome.rejected.length },
  };
}

/**
 * Everything a connector change goes through, once: the role check, the
 * opt-in, the dry run on `core/ops`, the confirm gate, and then either the
 * proposal queue or the change log.
 */
export async function land(caller: Caller, projectId: string, landing: Landing): Promise<Landed> {
  const { project, rev, doc } = await openProject(caller, projectId, "edit");
  const { ops, note, screenId, seed, confirm } = landing;

  if (!directWrites(project)) {
    const preamble = landing.preamble ?? "This project has not been opted in to direct writes, so the change was not applied.";
    // With no seeded tags the ops *are* the proposal, and `proposeEdit` runs
    // them again on accept against the project as it is then - which is what
    // makes accepting a subset of them mean anything.
    if (!seed) return queue(caller, projectId, ops, note, screenId, preamble);
    const run = dryRunOnSnapshot(seededDoc(doc, seed), ops, screenId);
    return queueBuild(caller, projectId, landing, run, changesFor(doc, seed, run), preamble);
  }

  const run = dryRunOnSnapshot(seededDoc(doc, seed), ops, screenId);
  const changes = changesFor(doc, seed, run);
  // A project opened from a customer's .eote is exported back into that same
  // file, so a change made here without being asked for would eventually
  // overwrite somebody's original. Deletions get the same bar for the
  // obvious reason: the dry run is the only chance to see them first.
  const opened = !!doc.source || !!doc.sourceId;
  if ((run.outcome.deleted || opened) && confirm !== true) {
    const why = run.outcome.deleted
      ? "these ops delete something"
      : "this project was opened from a customer's file and is exported back into it";
    const lines = reportLines(run.outcome);
    return {
      ...refusal(
        [
          `Not applied: ${why}, so it needs the engineer's explicit agreement. This is what it would have done - show it to them, and ask again with confirm: true only if they agree.`,
          projectData("dry run", limited(lines, RESULT_LIMIT - 2_000)),
        ].join("\n"),
        "needs-confirm",
      ),
      structured: { mode: "dry-run", needsConfirm: true, reason: run.outcome.deleted ? "deletes" : "opened-file", applied: run.outcome.applied.length, rejected: run.outcome.rejected.length },
      landed: { mode: "refused", lines, applied: 0, rejected: run.outcome.rejected.length },
    };
  }

  if (changes.length === 0) {
    const lines = reportLines(run.outcome);
    return {
      text: ["Nothing changed.", projectData("dry run", limited(lines, RESULT_LIMIT - 2_000))].join("\n"),
      structured: { mode: "direct", rev, applied: 0, rejected: run.outcome.rejected.length },
      landed: { mode: "nothing", rev, lines, applied: 0, rejected: run.outcome.rejected.length },
    };
  }

  // Authored by the agent and accepted by the caller: the opt-in is a
  // standing acceptance, and the change log already has a place to record
  // both, so the sign-off report still shows an AI change with a human's
  // name against it.
  const result = await repo().live.append(projectId, [
    { id: crypto.randomUUID(), base: rev, author: agentAuthor(), ops: changes, acceptedBy: caller.userId },
  ]);
  if (result.rejected.length > 0) {
    throw new ServerError(409, "stale", `The project changed while this was being worked out (${result.rejected[0].reason}); read it again and ask again`);
  }
  const lines = reportLines(run.outcome);
  return {
    text: [
      `Applied to "${field(project.name, 120)}" as revision ${result.rev}. Direct writes are on for this project, so no editor had to accept it.`,
      projectData("report", limited(lines, RESULT_LIMIT - 2_000)),
    ].join("\n"),
    structured: { mode: "direct", rev: result.rev, applied: run.outcome.applied.length, rejected: run.outcome.rejected.length, deleted: run.outcome.deleted },
    landed: { mode: "direct", rev: result.rev, lines, applied: run.outcome.applied.length, rejected: run.outcome.rejected.length },
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
    return land(caller, projectId, {
      ops,
      note: note ?? "Change asked for through the claude.ai connector",
      ...(screenId ? { screenId } : {}),
      ...(confirm === undefined ? {} : { confirm }),
    });
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
