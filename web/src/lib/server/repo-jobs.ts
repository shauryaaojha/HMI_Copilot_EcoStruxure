/**
 * A generation run as a record rather than a running function (phase 4, M3).
 *
 * Claude allows 240 s for one tool call (docs/CONNECTOR_SPEC_NOTES.md §2) and a
 * whole-application build can outlast that, so `generate` starts a job and
 * answers with its id. This is that job: the row the status tool reads, and the
 * only place its progress exists. Memory is not an option - a Vercel function
 * holds nothing between invocations - so the row is the source of truth and the
 * function working on it is merely the current attempt.
 *
 * The lease is the whole of the crash story. A runner claims the job for
 * `JOB_LEASE_MS` and pushes the lease forward on every step; a job whose lease
 * has passed is one whose function did not come back, and a reader says so
 * rather than reporting "running" forever. It is a reaper without a timer,
 * which is the only kind this deployment can have.
 *
 * Cancelling sets a flag and nothing else. A generator cannot be interrupted
 * from outside, so what cancelling really promises is that the run will not
 * write - which is the promise worth keeping, and the runner checks it in the
 * one place that matters, immediately before it lands anything.
 */
import { ServerError } from "./errors";
import { validId, type Data, type Row } from "./storage";
import type { Clock, Tx } from "./repo-collab";

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

/** One line of a run's progress, as the pipeline reported it. */
export interface JobStep {
  at: number;
  /** A pipeline step name, or "log" for a free line from the run. */
  step: string;
  state: "running" | "done" | "failed" | "log";
  detail?: string;
}

/**
 * What a finished job changed. Deliberately the vocabulary the write tools
 * already answer in (`lib/mcp/write.ts`), because a job's answer and
 * `apply_ops`' answer describe the same landing and should read the same.
 */
export interface JobResult {
  mode: "proposal" | "direct" | "nothing";
  proposalId?: string;
  rev?: number;
  /** One line per change, already fenced by the tool that reads it. */
  lines: string[];
  applied: number;
  rejected: number;
  screens: number;
  tags: number;
  alarms: number;
}

export type GenerationJob = Row & {
  projectId: string;
  /** The user the job belongs to; nobody else may read or cancel it. */
  requestedBy: string;
  requestedByName: string;
  /** What was asked for, in words, for the proposal and the audit line. */
  request: string;
  state: JobState;
  steps: JobStep[];
  createdAt: number;
  updatedAt: number;
  /** While running: the moment after which the runner is presumed gone. */
  expiresAt?: number;
  cancelRequested?: boolean;
  result?: JobResult;
  /** Why it failed, in words a connector can relay. */
  error?: string;
};

/**
 * How long a runner holds a job before a reader may call it dead. Generous
 * against the route's own 120 s ceiling: a job declared dead while its function
 * is still working would be reported failed and then land anyway, which is
 * worse than waiting another minute to hear bad news.
 */
export const JOB_LEASE_MS = 180_000;

/** The most progress one job keeps; a build reports tens of lines, not thousands. */
const MAX_STEPS = 200;

export type JobInput = Pick<GenerationJob, "projectId" | "requestedBy" | "requestedByName" | "request">;

export interface JobsRepo {
  create(job: JobInput): Promise<GenerationJob>;
  get(id: string): Promise<GenerationJob | null>;
  /** Take a queued job for one attempt, or `null` when it is not queued. */
  claim(id: string): Promise<GenerationJob | null>;
  /** Record progress and push the lease forward; answers the job as it now is. */
  step(id: string, step: Omit<JobStep, "at">): Promise<GenerationJob | null>;
  finish(id: string, outcome: { state: Exclude<JobState, "queued" | "running">; result?: JobResult; error?: string }): Promise<GenerationJob | null>;
  /** Ask a run to stop before it writes. Answers the job, or throws 404. */
  cancel(id: string): Promise<GenerationJob>;
  list(projectId: string): Promise<GenerationJob[]>;
}

/**
 * A job whose runner never came back, as the reader should see it. Not written
 * back here: a read is not the place to change a record, and the next status
 * call works it out again from the same lease.
 */
export function stalled(job: GenerationJob, now: number): boolean {
  return (job.state === "running" || job.state === "queued") && (job.expiresAt ?? 0) <= now;
}

/** Generation jobs, bound to the repository's transaction and clock. */
export function jobsRepo(tx: Tx, now: Clock): JobsRepo {
  const read = async (d: Data, id: string) => (validId(id) ? d.get<GenerationJob>("generationJobs", id) : null);
  return {
    create: job => tx(async d => {
      if (!await d.get("projects", job.projectId)) throw new ServerError(404, "not-found", "Project not found");
      const row: GenerationJob = {
        ...job,
        _id: crypto.randomUUID(),
        state: "queued",
        steps: [],
        createdAt: now(),
        updatedAt: now(),
        // Queued jobs get a lease too, so one whose function was frozen before
        // it ever claimed the job is reported dead rather than queued for ever.
        expiresAt: now() + JOB_LEASE_MS,
      };
      await d.put("generationJobs", row);
      return row;
    }),
    get: id => tx(d => read(d, id)),
    claim: id => tx(async d => {
      const job = await read(d, id);
      if (!job || job.state !== "queued") return null;
      const next: GenerationJob = { ...job, state: "running", updatedAt: now(), expiresAt: now() + JOB_LEASE_MS };
      await d.put("generationJobs", next);
      return next;
    }),
    step: (id, step) => tx(async d => {
      const job = await read(d, id);
      if (!job || (job.state !== "running" && job.state !== "queued")) return job;
      const steps = [...job.steps, { at: now(), ...step }].slice(-MAX_STEPS);
      const next: GenerationJob = { ...job, steps, updatedAt: now(), expiresAt: now() + JOB_LEASE_MS };
      await d.put("generationJobs", next);
      return next;
    }),
    finish: (id, outcome) => tx(async d => {
      const job = await read(d, id);
      if (!job) return null;
      const next: GenerationJob = { ...job, ...outcome, updatedAt: now() };
      delete next.expiresAt;
      await d.put("generationJobs", next);
      return next;
    }),
    cancel: id => tx(async d => {
      const job = await read(d, id);
      if (!job) throw new ServerError(404, "not-found", "No such generation job");
      // A finished job is left exactly as it finished: cancelling something
      // that already landed would misreport what is in the project.
      if (job.state !== "queued" && job.state !== "running") return job;
      const next: GenerationJob = { ...job, state: "cancelled", cancelRequested: true, updatedAt: now() };
      delete next.expiresAt;
      await d.put("generationJobs", next);
      return next;
    }),
    list: projectId => tx(async d => {
      const rows = await d.list<GenerationJob>("generationJobs", { projectId });
      return rows.sort((a, b) => b.createdAt - a.createdAt);
    }),
  };
}
