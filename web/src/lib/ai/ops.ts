/**
 * What a conversational turn is allowed to do to the project.
 *
 * The model does not write Screen.dat. It picks from this list, and every entry
 * maps onto a store action that already existed for the toolbar - so an edit
 * asked for in words and an edit made with the mouse take the same code path,
 * land in the same undo history, and are constrained by the same schema. A part
 * type the packager cannot emit cannot be named here, which is the one rule in
 * docs/BUILD_PLAN.md reaching the chat.
 *
 * The shape is deliberately flat rather than a discriminated union: Gemini's
 * response schema is an OpenAPI subset, and a flat object with an `op` enum and
 * optional fields survives it intact. Validity is re-checked here afterwards,
 * because no schema can express "an object with that name exists".
 */

import { z } from "zod";
import { PART_TYPES } from "@/lib/ote/schema";

export const OP_NAMES = [
  "addScreen",
  "renameScreen",
  "deleteScreen",
  "addObject",
  "addEquipment",
  "moveObject",
  "resizeObject",
  "setText",
  "setColor",
  "deleteObject",
  "duplicateObject",
  "alignObjects",
  "bindTag",
  "addAlarm",
] as const;

export type OpName = (typeof OP_NAMES)[number];

/** Palette names, because a model given "#2ecc71" would invent colours. */
export const COLOR_NAMES = [
  "ink",
  "paper",
  "green",
  "amber",
  "red",
  "grey",
  "white",
  "darkgrey",
  "black",
  "darkgreen",
] as const;

export const ALIGN_MODES = [
  "left",
  "centre",
  "right",
  "top",
  "middle",
  "bottom",
  "spreadHorizontal",
  "spreadVertical",
] as const;

export const Op = z.object({
  op: z.enum(OP_NAMES),
  /** Screen name the op applies to. Absent means the active screen. */
  screen: z.string().optional(),
  /** Object name the op acts on, or the new name for addScreen/renameScreen. */
  target: z.string().optional(),
  targets: z.array(z.string()).optional(),
  name: z.string().optional(),
  /**
   * For addEquipment: which unit to place, by the id or label inference gave
   * it - "PMP_101", "Boiler 4001". One op, one whole faceplate.
   */
  equipment: z.string().optional(),
  type: z.enum(PART_TYPES).optional(),
  text: z.string().optional(),
  offText: z.string().optional(),
  onText: z.string().optional(),
  tag: z.string().optional(),
  property: z.string().optional(),
  left: z.number().optional(),
  top: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fontSize: z.number().optional(),
  bold: z.boolean().optional(),
  decimals: z.number().optional(),
  colorRole: z.enum(["fill", "border", "text"]).optional(),
  color: z.enum(COLOR_NAMES).optional(),
  mode: z.enum(ALIGN_MODES).optional(),
  message: z.string().optional(),
  severity: z.number().optional(),
  alarmType: z.number().optional(),
  alarmKind: z.number().optional(),
  value: z.string().optional(),
  /** One line, in engineering language, for the build log on the turn. */
  note: z.string().optional(),
});

export type Op = z.infer<typeof Op>;

export const TurnMode = z.enum(["clarify", "build", "edit", "answer"]);
export type TurnMode = z.infer<typeof TurnMode>;

export const Turn = z.object({
  mode: TurnMode,
  /** What to say back. One or two sentences, engineering register. */
  reply: z.string(),
  /** Only when mode is "clarify" - the specific things still unknown. */
  questions: z.array(z.string()).optional(),
  /**
   * What this project should be called, offered only while it is still
   * "Untitled". A new project cannot be named before there is a request to
   * name it after, so it is named on the first turn rather than demanded up
   * front. Ignored once the project has any other name - renaming a project
   * out from under someone on their fourth request is worse than a slightly
   * wrong name on the first.
   */
  projectName: z.string().optional(),
  /** Only when mode is "edit" - what to change, in order. */
  ops: z.array(Op).optional(),
  /**
   * Only when mode is "build" - the request wants a whole screen generated from
   * the tag list, which is the eight-step pipeline rather than a list of edits.
   */
  buildIntent: z.string().optional(),
});

export type Turn = z.infer<typeof Turn>;

/**
 * Anything that is not a turn is treated as no turn, so a provider that drifts
 * degrades to "I did not understand that" rather than to a broken screen.
 */
export function coerceTurn(value: unknown): Turn | null {
  const parsed = Turn.safeParse(value);
  if (!parsed.success) return null;
  // Ops that name no target for an op that needs one are dropped rather than
  // applied against whatever happened to be selected.
  const needsEquipment: OpName[] = ["addEquipment"];
  const needsTarget: OpName[] = [
    "moveObject",
    "resizeObject",
    "setText",
    "setColor",
    "deleteObject",
    "duplicateObject",
    "bindTag",
  ];
  const ops = (parsed.data.ops ?? []).filter((op) => {
    if (needsTarget.includes(op.op) && !op.target) return false;
    if (needsEquipment.includes(op.op) && !op.equipment && !op.target) return false;
    return true;
  });
  return { ...parsed.data, ops };
}
