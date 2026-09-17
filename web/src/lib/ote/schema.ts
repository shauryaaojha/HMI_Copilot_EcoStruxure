/**
 * The shapes an EcoStruxure Screen.dat actually contains.
 *
 * These are deliberately narrow: the model generates against them via
 * zodOutputFormat, so a property the product does not define cannot survive
 * parsing. Every field here was taken from a real object in
 * reference/part_examples.json or from a .propDef in the installation - none of
 * it is invented.
 *
 * Phase 1 of docs/BUILD_PLAN.md. Extend one part at a time, each against its own
 * captured example.
 */

import { z } from "zod";

/** { Color: { Value: <palette index>, Transparency?: 0-100 } } */
export const ColorRef = z.object({
  Color: z.object({
    Value: z.number().int().min(1).max(60),
    Transparency: z.number().min(0).max(100).optional(),
  }),
});

/**
 * What a Fill or Border can be in the product's own files: a solid palette
 * colour, or a typed paint - `{ Type: 0 }` for none, `{ Type: 5, Color1,
 * Color2, Speed }` for a gradient. The typed form is carried through as-is
 * (passthrough) so a gradient survives the round trip; the canvas draws the
 * solid form and falls back sensibly on the rest.
 */
export const Paint = z.union([
  ColorRef,
  z.object({ Type: z.number().int() }).passthrough(),
]);

export const FontRef = z.object({
  Type: z.object({
    Type: z.literal(2),
    Value: z.string(),
    DisplayValue: z.string(),
  }),
  Size: z.number().positive().optional(),
  Bold: z.boolean().optional(),
  Italic: z.boolean().optional(),
});

export const Location = z.object({
  Left: z.number(),
  Top: z.number(),
});

/** Horizontal: 1 left, 2 centre, 4 right. Vertical: 64 middle. */
export const TextLayout = z.object({
  HorizontalAlignment: z.number().int().optional(),
  VerticalAlignment: z.number().int().optional(),
  Wrap: z.boolean().optional(),
});

const base = {
  UniqueId: z.string().uuid(),
  Name: z.string(),
  Location: Location,
  Width: z.number().nonnegative(),
  Height: z.number().nonnegative(),
};

export const Rectangle = z.object({
  Type: z.literal("Rectangle"),
  ...base,
  Fill: Paint.optional(),
  Border: Paint.optional(),
  Thickness: z.number().optional(),
});

export const TextBox = z.object({
  Type: z.literal("TextBox"),
  ...base,
  Text: z.string(),
  TextColor: ColorRef.optional(),
  Font: FontRef.optional(),
  TextLayout: TextLayout.optional(),
});

/** A Lamp carries both states in the JSON; the bound tag chooses between them. */
const LampState = z.object({
  Text: z.string().optional(),
  TextColor: ColorRef.optional(),
  Font: FontRef.optional(),
  TextLayout: TextLayout.optional(),
  Fill: Paint.optional(),
  Border: Paint.optional(),
  Thickness: z.number().optional(),
});

export const Lamp = z.object({
  Type: z.literal("Lamp"),
  ...base,
  Off: LampState,
  On: LampState,
});

export const NumericDisplay = z.object({
  Type: z.literal("NumericDisplay"),
  ...base,
  CurrentValue: z.number().default(0),
  DecimalDigits: z.number().int().min(0).max(6).optional(),
  TextColor: ColorRef.optional(),
  Font: FontRef.optional(),
  Fill: Paint.optional(),
  Border: Paint.optional(),
  Thickness: z.number().optional(),
  TextLayout: TextLayout.optional(),
});

export const AlarmSummary = z.object({
  Type: z.literal("AlarmSummary"),
  ...base,
});

/** One of the 475 shipped graphic objects, placed as path geometry. */
export const PathPart = z.object({
  Type: z.literal("Path"),
  ...base,
  Commands: z.string(),
  Points: z.string(),
  Fill: Paint.optional(),
  Border: Paint.optional(),
  Thickness: z.number().optional(),
});

/**
 * A Switch is a touch target with a face for each of its two states, and a
 * click trigger saying what a touch does. Property names are the product's
 * (reference/part_examples.json, Demo 1.eote); the geometry is absolute, as
 * for every part placed on a canvas rather than in a grid.
 */
export const ClickTrigger = z.object({
  OperationType: z.number().int(),
  Operation: z.number().int().optional(),
  Source: z.string().optional(),
  Screen: z.number().int().optional(),
  Content: z.number().int().optional(),
});

export const Switch = z.object({
  Type: z.literal("Switch"),
  ...base,
  Release: LampState,
  Press: LampState,
  ClickTrigger: ClickTrigger.optional(),
});

/** An indicator with two to sixteen faces; the bound integer picks one. */
export const NStateLamp = z.object({
  Type: z.literal("N-StateLamp"),
  ...base,
  NumberOfStates: z.number().int().min(2).max(16),
  States: z.array(LampState).min(2).max(16),
  Invalid: LampState.optional(),
  CurrentValue: z.number().int().default(0),
});

/** Text from a STRING tag, as a NumericDisplay is a number from a numeric one. */
export const StringDisplay = z.object({
  Type: z.literal("StringDisplay"),
  ...base,
  CurrentValue: z.string().default(""),
  DisplayLength: z.number().int().min(1).max(255).optional(),
  TextColor: ColorRef.optional(),
  Font: FontRef.optional(),
  Fill: Paint.optional(),
  Border: Paint.optional(),
  Thickness: z.number().optional(),
  TextLayout: TextLayout.optional(),
});

export const Part = z.discriminatedUnion("Type", [
  Rectangle,
  TextBox,
  Lamp,
  NumericDisplay,
  AlarmSummary,
  PathPart,
  Switch,
  NStateLamp,
  StringDisplay,
]);

export const ViewBox = z.object({
  Type: z.literal("ViewBox"),
  UniqueId: z.string().uuid(),
  Name: z.string(),
  Options: z.number().int().optional(),
  Width: z.number().positive(),
  Height: z.number().positive(),
  Children: z.array(Part),
});

export const Screen = z.object({
  Type: z.literal("Screen"),
  UniqueId: z.string().uuid(),
  Name: z.string(),
  Children: z.tuple([ViewBox]),
});

export type ColorRef = z.infer<typeof ColorRef>;
export type Part = z.infer<typeof Part>;
export type PartType = Part["Type"];

/**
 * The part types by name, for anywhere a list is needed rather than a type -
 * a toolbar, an enum in a model's response schema. Kept beside the union so
 * adding a part to one without the other is a compile error, not a silent gap.
 */
export const PART_TYPES = [
  "Rectangle",
  "TextBox",
  "Lamp",
  "NumericDisplay",
  "AlarmSummary",
  "Path",
  "Switch",
  "N-StateLamp",
  "StringDisplay",
] as const satisfies readonly PartType[];
export type ViewBox = z.infer<typeof ViewBox>;
export type Screen = z.infer<typeof Screen>;

/* ---------------------------------------------------------------------- */
/* Variables and alarms                                                    */
/* ---------------------------------------------------------------------- */

export const DATA_TYPES = [
  "BOOL",
  "INT",
  "DINT",
  "UINT",
  "UDINT",
  "WORD",
  "DWORD",
  "REAL",
  "LREAL",
  "STRING",
] as const;

export const Variable = z.object({
  Name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "invalid OTE variable name"),
  DataType: z.enum(DATA_TYPES),
  Comments: z.string().default(""),
  DeviceAddress: z.string().default(""),
});

/** AlarmType 1-4 = HiHi/Hi/Lo/LoLo. AlarmRecordType 1 = bit, 2 = level. */
export const Alarm = z.object({
  Message: z.string(),
  Trigger: z.string(),
  AlarmType: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  AlarmRecordType: z.union([z.literal(1), z.literal(2)]),
  Severity: z.number().int().min(1).max(9),
  Value: z.string(),
});

export type Variable = z.infer<typeof Variable>;
export type Alarm = z.infer<typeof Alarm>;

export const ALARM_LEVEL = { 1: "HiHi", 2: "Hi", 3: "Lo", 4: "LoLo" } as const;
export const ALARM_KIND = { 1: "bit", 2: "level" } as const;
