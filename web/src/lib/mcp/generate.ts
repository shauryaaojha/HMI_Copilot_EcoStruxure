/**
 * Building a whole application as a job: M3 of phase 4.
 *
 * Claude allows 240 s for one tool call (docs/CONNECTOR_SPEC_NOTES.md §2). A
 * build is a model call plus the eight-step pipeline, and on a real tag list it
 * outlasts that, so `generate` cannot be the tool that waits. It starts the
 * work, answers with a job id, and `generation_status` is where the progress
 * and the result are read.
 *
 * ## Where the work runs, and what that costs
 *
 * A Vercel function is stateless and may be frozen the moment it responds, so
 * an in-process job that outlives its request is not something this deployment
 * can promise. Two ways out were available: run the work in `after()` from
 * next/server, which is how `api/projects/[id]/agent/route.ts` and
 * `changes/route.ts` already defer theirs, or keep the job in Mongo and push it
 * one step further on each status poll.
 *
 * `after()` wins, and the Mongo record is the source of truth either way. The
 * pipeline is one `AsyncGenerator` whose state is a closure - the plan, the
 * plant model, the placer - and nothing can serialise that between two
 * invocations, so "advance it on the next poll" would mean restarting the run
 * from the beginning each time and paying for the model call again. `after()`
 * keeps one attempt, one model call, one answer.
 *
 * What that does not survive, stated plainly:
 *
 *   - **The run itself does not survive a cold start.** If the function is
 *     frozen or recycled while the pipeline is mid-flight, the work is gone.
 *     Nothing resumes it; the engineer calls `generate` again.
 *   - **A dead run is found by its lease, not by a timer.** The job row carries
 *     `expiresAt`, pushed forward on every step. A reader that finds a running
 *     job whose lease has passed reports it failed (`stalled` in
 *     `lib/server/repo-jobs.ts`), because there is no process left to ask.
 *   - **`after()` is best effort.** On a platform that drops it, the job stays
 *     `queued` until its lease runs out and is then reported failed. That is
 *     the failure mode to watch, and it is visible rather than silent.
 *
 * The one thing that is safe about a death mid-run is deliberate: the job
 * writes exactly once, at the end, through `land`. There is no such thing as a
 * half-built project here - either the whole application landed, or nothing
 * did.
 *
 * ## What the job is allowed to do
 *
 * Nothing more than a connector call made by hand. The role is checked through
 * `lib/server/access.ts` at the start and again at the write (`openProject`
 * inside `land`), and the landing is `write.ts`'s - so a project that has not
 * been opted in to direct writes gets a **proposal** from a job exactly as it
 * does from `apply_ops`. A job is a slow caller, not a privileged one.
 *
 * ## Why the pipeline decides and core/ops draws
 *
 * The pipeline compiles geometry; the project's write path speaks the `Op`
 * union and nothing else (`core/ops/index.ts`). So what the job takes from the
 * run is the *decision* - which screens, which equipment on each, which alarms -
 * and lands it as `addScreen`, `addEquipment` and `addAlarm`, drawn by the same
 * layout engine the toolbar uses. The cost is real and worth naming: the
 * pipeline's own process views and KPI bands are not carried through, because
 * no op expresses them. The alternative was a second applier for jobs, which
 * is the thing one write path exists to prevent.
 *
 * ## Project text is data
 *
 * A plant description, a brief label and a tag comment all reach this file as
 * strings, and none of them changes what the job does: the brief is parsed into
 * a `Brief`, the ops are built from its rows and the pipeline's plan, and every
 * word of it leaves inside the `projectData` fence.
 */
import { after } from "next/server";
import { z } from "zod";
import type { Op } from "@/core/ops";
import { askJson } from "@/lib/ai/draft";
import { runPipeline } from "@/lib/ai/pipeline";
import { Brief, placeholderImport, problemsWith, requestFromBrief } from "@/lib/brief/brief";
import { draftBrief } from "@/lib/brief/draft";
import { checkBrief } from "@/lib/brief/validate";
import type { Alarm } from "@/lib/ote/schema";
import { ServerError } from "@/lib/server/errors";
import { GENERATES_PER_PROJECT, GENERATES_PER_USER, countAttempt } from "@/lib/server/rate-limit";
import { repo, stalled, type GenerationJob, type JobResult, type JobStep } from "@/lib/server/repo";
import { PIPELINE_STEPS, type GenerationEvent } from "@/types/events";
import type { Caller } from "./caller";
import { field, limited, projectData, RESULT_LIMIT } from "./data";
import { openProject } from "./project";
import { refusal } from "./result";
import { tool, type McpTool } from "./spec";
import { land, type SeedTags } from "./write";

/** How many clarify answers are read, and how long each may be - the same as `api/brief/draft`. */
const ANSWERS = 2;
const LONGEST = 2_000;

/**
 * The most ops one build may land, which is `write.ts`'s own ceiling on a turn.
 * A brief that asks for more is refused rather than cut: half an application is
 * a worse answer than "ask for less", because its navigation names screens that
 * were never built.
 */
const MAX_BUILD_OPS = 200;

/** The brief as the connector may send it: the rows, nothing about geometry. */
const BriefArg = z
  .object({
    plant: z.object({ name: z.string().optional(), purpose: z.string().optional() }).optional(),
    units: z.array(
      z.object({
        id: z.string().optional(),
        kind: z.string(),
        label: z.string(),
        count: z.number().int().optional(),
        signals: z.array(z.string()).optional(),
        customSignals: z.array(z.object({ id: z.string(), type: z.string(), what: z.string().optional() })).optional(),
      }),
    ),
    alarms: z.array(z.string()).optional(),
    screens: z.object({ overview: z.boolean().optional(), perUnitGroup: z.boolean().optional(), alarms: z.boolean().optional() }).optional(),
    naming: z.object({ start: z.number().int().min(1).optional() }).optional(),
  })
  .passthrough();

/**
 * A row without an id gets one from its position, because `Brief` requires one
 * and provenance is keyed by it: two rows sharing an id would make every tag
 * trace to the wrong equipment (`problemsWith` refuses that outright).
 */
function briefFrom(value: z.infer<typeof BriefArg>): Brief {
  const units = value.units.map((unit, i) => ({ ...unit, id: unit.id?.trim() || `unit-${i + 1}` }));
  return Brief.parse({ ...value, units });
}

/** The fields that stop a brief being built from, named one per line. */
function unconfirmed(brief: Brief) {
  const problems = problemsWith(brief);
  const lines = problems.map((p) => `${field(p.unitId ?? "brief", 60)}.${field(p.field, 40)}: ${field(p.message, 300)}`);
  return {
    ...refusal(
      [
        `Nothing was built and no tags were created. The brief cannot be confirmed yet: ${problems.length} field(s) need an answer. Ask the engineer for them, then call generate again with the brief filled in.`,
        projectData("brief problems", limited(lines, RESULT_LIMIT - 2_000)),
      ].join("\n"),
      "brief-unconfirmed",
    ),
    structured: { refused: true, code: "brief-unconfirmed", problems: problems.map((p) => ({ unitId: p.unitId, field: p.field })) },
  };
}

/** The brief read back to the engineer, so they confirm rows rather than a sentence. */
function forReview(brief: Brief, by: string, questions?: string[]) {
  const lines = [
    `plant: ${field(brief.plant.name, 120)}${brief.plant.purpose ? ` - ${field(brief.plant.purpose, 300)}` : ""}`,
    ...brief.units.map((u) => `unit ${field(u.id, 60)}: ${field(u.count ?? 0, 10)} x ${field(u.label, 120)} (${field(u.kind, 40)}), signals ${field(u.signals.join(" "), 300)}`),
    ...(questions ?? []).map((q) => `still unknown: ${field(q, 300)}`),
  ];
  return {
    text: [
      questions?.length
        ? "Nothing was built and no tags were created: the description did not say enough. Ask the engineer these questions and call generate again with their answers."
        : `Nothing was built and no tags were created yet. This is what the description was read as (${field(by, 20)}). Show it to the engineer; if they agree, call generate again with confirm: true, or send the rows back as brief with their corrections.`,
      projectData("drafted brief", limited(lines, RESULT_LIMIT - 2_000)),
    ].join("\n"),
    structured: { brief, by, ...(questions?.length ? { questions } : {}), needsConfirm: true },
  };
}

/**
 * Hands the run to `after()`, which Vercel keeps alive past the response.
 *
 * Outside a request scope - a test, a script - `after` throws, and the work
 * still has to happen. A timer rather than a bare call, so the tool has
 * certainly answered before the runner claims the job: "returns a job id
 * without waiting" is the contract, and it should be true by construction and
 * not by luck.
 */
function defer(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    setTimeout(() => void work(), 0);
  }
}

/** A screen the pipeline decided on, with the equipment it decided to put there. */
interface PlannedScreen {
  name: string;
  faceplates: string[];
}

/** What one run of the pipeline came out with, and what it said on the way. */
interface RunOutcome {
  screens: PlannedScreen[];
  alarms: Alarm[];
  tags: number;
  error?: string;
}

/**
 * The plan as ops.
 *
 * Each screen is added and then filled, and the equipment ops deliberately
 * name no screen: `core/ops` resolves an unnamed screen to the active one,
 * which `addScreen` has just made the screen it created. Naming it instead
 * would mean guessing the name the store landed on, and the store renames a
 * screen whose name is taken.
 */
function opsFor(outcome: RunOutcome): Op[] {
  const ops: Op[] = [];
  for (const screen of outcome.screens) {
    ops.push({ op: "addScreen", name: screen.name });
    for (const id of screen.faceplates) ops.push({ op: "addEquipment", equipment: id });
  }
  for (const alarm of outcome.alarms) {
    ops.push({
      op: "addAlarm",
      target: alarm.Trigger,
      message: alarm.Message,
      alarmType: alarm.AlarmType,
      alarmKind: alarm.AlarmRecordType,
      severity: alarm.Severity,
      ...(alarm.Value ? { value: alarm.Value } : {}),
    });
  }
  return ops;
}

/** One pipeline event as a line of the job's progress, or nothing worth keeping. */
function progressOf(event: GenerationEvent): Omit<JobStep, "at"> | null {
  if (event.type === "step") return { step: event.step, state: event.state === "pending" ? "running" : event.state, ...(event.detail ? { detail: event.detail } : {}) };
  if (event.type === "log") return { step: "log", state: "log", detail: event.message };
  if (event.type === "error") return { step: "log", state: "failed", detail: event.message };
  return null;
}

/**
 * The run, recording its progress as it goes.
 *
 * Every step is written to the job row, which is what makes progress readable
 * from another invocation and what pushes the lease forward. A `step` write
 * that comes back cancelled stops the run before it has written anything.
 */
async function runPipelineInto(jobId: string, input: Parameters<typeof runPipeline>[0]): Promise<RunOutcome> {
  const storage = repo();
  const outcome: RunOutcome = { screens: [], alarms: [], tags: 0 };
  for await (const event of runPipeline(input)) {
    const step = progressOf(event);
    if (step) {
      const job = await storage.jobs.step(jobId, step);
      if (!job || job.state === "cancelled") throw new ServerError(409, "cancelled", "The job was cancelled");
    }
    if (event.type === "tags") outcome.tags = event.variables.length;
    if (event.type === "program") {
      outcome.screens.push({ name: event.program.name, faceplates: event.program.faceplates ?? [] });
    }
    if (event.type === "alarm") outcome.alarms.push(event.alarm);
    if (event.type === "error") outcome.error = event.message;
  }
  return outcome;
}

/**
 * One attempt at a job: claim it, build, land it once, record what happened.
 *
 * Takes the job by id and reads it back rather than trusting what was handed
 * over, because the row is the only thing that knows whether somebody has
 * already claimed this or cancelled it.
 */
export async function runGenerationJob(jobId: string, caller: Caller, brief: Brief, by: "model" | "rules" | "form", confirm?: boolean): Promise<void> {
  const storage = repo();
  const claimed = await storage.jobs.claim(jobId);
  if (!claimed) return;
  const projectId = claimed.projectId;
  try {
    // The placeholder tags, which exist only now that the brief has passed the
    // gate. They are not written on their own: they travel into `land` with
    // the ops that draw them.
    const { variables, confirmed, tagImport } = placeholderImport(brief, by);
    const seed: SeedTags = { variables, tagImport };
    const { doc } = await openProject(caller, projectId, "edit");
    const intent = requestFromBrief(brief);

    const outcome = await runPipelineInto(jobId, {
      intent,
      variables,
      panel: { model: doc.target.model, width: doc.target.width, height: doc.target.height },
    });
    if (outcome.error) throw new ServerError(422, "pipeline", outcome.error);

    const ops = opsFor(outcome);
    if (ops.length > MAX_BUILD_OPS) {
      throw new ServerError(
        400,
        "too-large",
        `This brief comes to ${ops.length} changes and a build lands at most ${MAX_BUILD_OPS}. Lower the counts, or build it in parts.`,
      );
    }

    // The last look before anything is written, which is all cancelling can
    // honestly promise: a generator cannot be interrupted from outside.
    const before = await storage.jobs.get(jobId);
    if (!before || before.state === "cancelled") return;

    // `confirm` carries two agreements at once, and that is sound here rather
    // than sloppy: a build is refused outright on a project that already has
    // objects, so the only project that can reach `land`'s opened-file gate is
    // an empty one from a customer's file - and agreeing to build it is
    // agreeing to that.
    const landed = await land(caller, projectId, {
      ops,
      note: intent,
      seed,
      label: `Generated application: ${outcome.screens.length} screen(s) from the confirmed brief`,
      preamble: "This project has not been opted in to direct writes, so the generated application was not applied.",
      ...(confirm === undefined ? {} : { confirm }),
    });

    // The other half of §5.3's "checked, never trusted": the tags that landed
    // are asked, separately, which confirmed row each traces to.
    for (const finding of checkBrief(variables, confirmed)) {
      await storage.jobs.step(jobId, { step: "validate", state: "log", detail: `${finding.severity}: ${finding.message}` });
    }

    const result: JobResult = {
      mode: landed.landed.mode === "refused" ? "nothing" : landed.landed.mode,
      ...(landed.landed.proposalId ? { proposalId: landed.landed.proposalId } : {}),
      ...(landed.landed.rev === undefined ? {} : { rev: landed.landed.rev }),
      lines: landed.landed.lines,
      applied: landed.landed.applied,
      rejected: landed.landed.rejected,
      screens: outcome.screens.length,
      tags: outcome.tags,
      alarms: outcome.alarms.length,
    };
    if (landed.landed.mode === "refused") {
      await storage.jobs.finish(jobId, { state: "failed", result, error: landed.text ?? "The build needs the engineer's explicit agreement." });
      return;
    }
    await storage.jobs.finish(jobId, { state: "done", result });
  } catch (error) {
    if (error instanceof ServerError && error.code === "cancelled") return;
    // A job's failure is a message for the engineer, so the reason survives;
    // anything that is not a `ServerError` is not ours to quote.
    await storage.jobs.finish(jobId, {
      state: "failed",
      error: error instanceof ServerError ? error.message : "The build failed before anything was written.",
    });
  }
}

const generateTool = tool({
  name: "generate",
  title: "Generate an application",
  description:
    "Builds a whole HMI application - screens, faceplates, alarms and bindings - from a plant brief, and returns a job id straight away because a build takes longer than one tool call may. Send a description to have the brief drafted and read back for the engineer to agree to; send brief with the rows once they have. Nothing is built, and no tags exist, until the brief has a count and signals for every unit. Poll generation_status with the job id for progress and the result.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  input: {
    projectId: z.string().describe("The project id, from list_projects."),
    description: z.string().max(4_000).optional().describe("What the plant is and what it has, in the engineer's words."),
    answers: z.array(z.string().max(LONGEST)).max(ANSWERS).optional().describe("What the engineer replied to the questions a previous call asked."),
    brief: BriefArg.optional().describe("The plant brief the engineer has agreed to: the units, with a count and signals for each."),
    confirm: z.boolean().optional().describe("Set only after the engineer has read the drafted brief a previous call returned, or agreed to a direct write into a project opened from their file."),
  },
  async run({ projectId, description, answers, brief: given, confirm }, { caller }) {
    // The role first, so a caller who may only read is told so before a model
    // is asked anything.
    const { project, doc } = await openProject(caller, projectId, "edit");
    if (doc.screens.some((screen) => screen.Children[0].Children.length > 0)) {
      return refusal(
        `"${field(project.name, 120)}" already has screens with objects on them. generate lays out an application from nothing; ask for a change to what is there with apply_ops or propose instead.`,
        "already-built",
      );
    }

    let brief: Brief;
    let by: "model" | "rules" | "form";
    if (given) {
      brief = briefFrom(given);
      by = "form";
    } else {
      const said = (description ?? "").trim();
      if (!said && !(answers ?? []).length) {
        throw new ServerError(400, "invalid", "Say what the plant is, or send the brief the engineer agreed to");
      }
      const drafted = await draftBrief(said, { ask: askJson, answers: (answers ?? []).slice(0, ANSWERS).map((a) => a.slice(0, LONGEST)) });
      brief = drafted.brief;
      by = drafted.by === "model" ? "model" : "rules";
      // A description nobody has looked at is not a confirmed brief. The rows
      // go back for the engineer to agree to, which is the order
      // docs/PLAN_FULL_ARCHITECTURE.md §5.2 is about: they found out what had
      // been assumed by reading what had already been drawn.
      if (drafted.questions?.length) return forReview(brief, drafted.by, drafted.questions);
      if (confirm !== true) return forReview(brief, drafted.by);
    }

    const problems = problemsWith(brief);
    if (problems.length > 0) return unconfirmed(brief);

    // Counted here: past every gate, and before the model call the pipeline is
    // about to make. A refused brief should not cost an engineer an allowance.
    await countAttempt("generate-user", caller.userId, GENERATES_PER_USER);
    await countAttempt("generate-project", projectId, GENERATES_PER_PROJECT);

    const job = await repo().jobs.create({
      projectId,
      requestedBy: caller.userId,
      requestedByName: caller.name,
      request: requestFromBrief(brief),
    });
    defer(() => runGenerationJob(job._id, caller, brief, by, confirm));
    return {
      text: [
        `Started as job ${job._id}. It is queued, not finished: call generation_status with that id for the steps as they happen and for the result.`,
        `${brief.units.length} unit row(s) confirmed; the tags will be placeholders drafted from the brief, not a real export.`,
        `Changes land ${project.connector?.directWrites === true ? "directly, because this project is opted in to direct writes" : "as a proposal for an editor to accept"}.`,
      ].join("\n"),
      structured: { jobId: job._id, state: job.state, units: brief.units.length },
    };
  },
});

/** The steps so far, newest last, each field fenced because the detail is project text. */
function stepLines(job: GenerationJob): string[] {
  return job.steps.map((s) => `${field(s.step, 40)} ${field(s.state, 20)}${s.detail ? `: ${field(s.detail, 400)}` : ""}`);
}

/** How far through the eight steps this run got. */
function reached(job: GenerationJob): { done: number; percent: number } {
  const done = new Set(job.steps.filter((s) => s.state === "done").map((s) => s.step));
  const counted = [...done].filter((name) => (PIPELINE_STEPS as readonly string[]).includes(name)).length;
  return { done: counted, percent: Math.round((counted / PIPELINE_STEPS.length) * 100) };
}

/**
 * The job, if it is this caller's.
 *
 * A job somebody else started answers the same way as a job that does not
 * exist, because telling a stranger that an id is real is itself an answer.
 * The project role is still asked of `access.ts` afterwards: ownership of the
 * job and permission on the project are two different questions and this has
 * no opinion on the second.
 */
async function ownJob(caller: Caller, jobId: string): Promise<GenerationJob> {
  const job = await repo().jobs.get(jobId);
  if (!job || job.requestedBy !== caller.userId) {
    throw new ServerError(404, "not-found", "No generation job of yours has that id");
  }
  await openProject(caller, job.projectId, "read");
  return job;
}

const statusTool = tool({
  name: "generation_status",
  title: "Generation status",
  description:
    "Where a generate job has got to: queued, running, done, failed or cancelled, how many of the eight pipeline steps are finished, every step it has reported so far, and - once it is done - what changed, as a proposal waiting for an editor or as the revision it landed at. Only the caller who started the job can read it.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: { jobId: z.string().describe("The job id generate returned.") },
  async run({ jobId }, { caller }) {
    const job = await ownJob(caller, jobId);
    // A run whose lease has passed is one whose function did not come back.
    // Said once, here, rather than left to look like progress that stopped.
    const dead = stalled(job, Date.now());
    const state = dead ? "failed" : job.state;
    const { done, percent } = reached(job);
    const head = [`Job ${job._id}: ${state}. ${done} of ${PIPELINE_STEPS.length} steps done (${percent}%).`];
    if (dead) head.push("The function running this build did not come back, so it is finished as failed. Nothing was written - a build lands once, at the end. Call generate again.");
    if (job.error) head.push(field(job.error, 1_000));
    const result = job.result;
    if (result?.mode === "proposal") {
      head.push(`Queued as proposal ${field(result.proposalId, 60)} for an editor to accept: ${result.screens} screen(s), ${result.tags} placeholder tag(s), ${result.alarms} alarm(s). Nothing in the project has changed yet.`);
    } else if (result?.mode === "direct") {
      head.push(`Applied as revision ${field(result.rev, 20)}: ${result.screens} screen(s), ${result.tags} placeholder tag(s), ${result.alarms} alarm(s).`);
    } else if (result?.mode === "nothing") {
      head.push("The build produced no change to the project.");
    }
    const lines = [...stepLines(job), ...(result?.lines ?? []).map((l) => `result: ${l}`)];
    return {
      text: [head.join("\n"), projectData("generation", limited(lines, RESULT_LIMIT - 3_000))].join("\n"),
      structured: {
        jobId: job._id,
        state,
        steps: done,
        of: PIPELINE_STEPS.length,
        percent,
        ...(result ? { mode: result.mode, applied: result.applied, rejected: result.rejected, screens: result.screens, tags: result.tags, alarms: result.alarms, ...(result.proposalId ? { proposalId: result.proposalId } : {}), ...(result.rev === undefined ? {} : { rev: result.rev }) } : {}),
      },
    };
  },
});

const cancelTool = tool({
  name: "generation_cancel",
  title: "Cancel a generation",
  description:
    "Stops a generate job from writing anything. A run already in flight is not interrupted - it finishes working and then writes nothing - so a cancelled job never lands a half-built application. Only the caller who started the job can cancel it.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  input: { jobId: z.string().describe("The job id generate returned.") },
  async run({ jobId }, { caller }) {
    const own = await ownJob(caller, jobId);
    const job = await repo().jobs.cancel(own._id);
    return {
      text:
        job.state === "cancelled"
          ? `Job ${job._id} is cancelled and will not write to the project.`
          : `Job ${job._id} had already finished as ${job.state}; nothing was cancelled.`,
      structured: { jobId: job._id, state: job.state },
    };
  },
});

export const GENERATE_TOOLS: readonly McpTool[] = [generateTool, statusTool, cancelTool];
