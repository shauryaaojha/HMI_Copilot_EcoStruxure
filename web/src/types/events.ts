/**
 * The contract between the generation pipeline and the UI.
 *
 * /api/generate streams these as SSE. The build timeline renders `step` and `log`,
 * the canvas appends on `object`, the binding map fills in on `binding`. One
 * complete object at a time - never a partially-parsed JSON tree, because a half
 * object cannot be rendered and cannot be validated.
 *
 * Phase 4 of docs/BUILD_PLAN.md.
 */

import type { Alarm, Part, Variable } from "@/lib/ote/schema";

/** The eight pipeline steps, in order. */
export const PIPELINE_STEPS = [
  "ingest",
  "infer",
  "select",
  "layout",
  "alarms",
  "bindings",
  "validate",
  "package",
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export const STEP_LABELS: Record<PipelineStep, string> = {
  ingest: "Parse PLC tags",
  infer: "Infer equipment",
  select: "Select library objects",
  layout: "Generate screen layout",
  alarms: "Configure alarms",
  bindings: "Resolve tag bindings",
  validate: "Run validation",
  package: "Build export files",
};

export type StepState = "pending" | "running" | "done" | "failed";

export interface Equipment {
  id: string;
  kind: string;
  label: string;
  tags: string[];
  /** category/name into the shipped graphic object library, when one applies */
  symbol?: string;
}

export type GenerationEvent =
  /** A step changed state. `detail` is engineering language, not "Thinking...". */
  | { type: "step"; step: PipelineStep; state: StepState; detail?: string }
  /** A free-form log line for the timeline's right-hand pane. */
  | { type: "log"; at: string; message: string }
  /** Tags were parsed and normalised. */
  | { type: "tags"; variables: Variable[] }
  /** Equipment inference produced a proposal for the engineer to confirm. */
  | { type: "equipment"; equipment: Equipment[] }
  /**
   * One finished screen object. The canvas appends it immediately.
   *
   * `screenName` names the screen the parent ViewBox belongs to. The contract
   * has no "screen created" event - a screen is implied by the first object
   * that names its ViewBox - so without this the consumer had to invent a name,
   * and every generated screen came out called after the project. Optional, so
   * an older producer still parses.
   */
  | { type: "object"; part: Part; parentId: string; screenName?: string }
  /** One resolved binding. */
  | { type: "binding"; tag: string; target: string; property: string }
  /** One configured alarm. */
  | { type: "alarm"; alarm: Alarm }
  /** A validation finding, clickable back to its object. */
  | {
      type: "finding";
      severity: "error" | "warning" | "info";
      message: string;
      objectId?: string;
      suggestion?: string;
    }
  | { type: "done"; screenId: string }
  | { type: "error"; message: string };
