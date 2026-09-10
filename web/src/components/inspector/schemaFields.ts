/**
 * Property editors derived from the zod schemas, not written per part type.
 *
 * docs/BUILD_PLAN.md Phase 5 asks for exactly this: "a part gains an editor the
 * moment it gains a schema". So nothing here enumerates Rectangle's fields or
 * Lamp's - it walks lib/ote/schema.ts at runtime and classifies whatever it
 * finds. Add a property to a part in schema.ts and it appears in the inspector
 * with a working editor and no change to this file.
 *
 * The classification is structural rather than by field name: a field is a
 * colour because its shape is { Color: { Value } }, which is how the product
 * writes a palette reference - not because it happens to be called "Fill".
 */

import { z } from "zod";
import { Part } from "@/lib/ote/schema";

export type FieldKind =
  | "text"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "literal"
  | "color"
  | "font"
  | "location"
  | "align"
  | "group"
  | "unknown";

export interface SchemaField {
  /** Path from the part root, e.g. ["Off", "Fill"]. */
  path: string[];
  key: string;
  kind: FieldKind;
  optional: boolean;
  /** Editors are not offered for these; the value is shown and left alone. */
  readOnly: boolean;
  /** For "enum". */
  options?: string[];
  /** For "group" - a nested object with fields of its own, like a Lamp state. */
  fields?: SchemaField[];
  min?: number;
  max?: number;
}

export interface FieldGroup {
  title: string;
  fields: SchemaField[];
}

/** Peel ZodOptional / ZodDefault / ZodNullable down to the type underneath. */
function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean } {
  let inner = schema;
  let optional = false;
  for (;;) {
    const name = inner._def.typeName;
    if (name === "ZodOptional" || name === "ZodDefault" || name === "ZodNullable") {
      optional = optional || name !== "ZodDefault";
      inner = inner._def.innerType as z.ZodTypeAny;
      continue;
    }
    return { inner, optional };
  }
}

/** Numeric constraints, so a spinner cannot produce a value zod would reject. */
function rangeOf(schema: z.ZodTypeAny): { min?: number; max?: number; integer: boolean } {
  const checks = (schema._def.checks ?? []) as { kind: string; value?: number }[];
  let min: number | undefined;
  let max: number | undefined;
  let integer = false;
  for (const check of checks) {
    if (check.kind === "min") min = check.value;
    if (check.kind === "max") max = check.value;
    if (check.kind === "int") integer = true;
  }
  return { min, max, integer };
}

const keysOf = (schema: z.ZodTypeAny) => Object.keys((schema as z.AnyZodObject).shape ?? {});

/** Recognises the product's own composite shapes by their structure. */
function shapeKind(object: z.ZodTypeAny): FieldKind {
  const keys = keysOf(object);
  if (keys.length === 1 && keys[0] === "Color") return "color";
  if (keys.includes("Left") && keys.includes("Top")) return "location";
  if (keys.includes("HorizontalAlignment") || keys.includes("VerticalAlignment"))
    return "align";
  // A FontRef always carries the product's font Type descriptor.
  if (keys.includes("Type") && keys.includes("Size")) return "font";
  return "group";
}

/** UniqueId and the Type discriminant identify the object; they are not editable. */
const READ_ONLY = new Set(["UniqueId", "Type"]);

function describe(key: string, schema: z.ZodTypeAny, path: string[]): SchemaField {
  const { inner, optional } = unwrap(schema);
  const at = [...path, key];
  const readOnly = READ_ONLY.has(key);

  switch (inner._def.typeName) {
    case "ZodString":
      return { path: at, key, kind: "text", optional, readOnly };

    case "ZodNumber": {
      const { min, max, integer } = rangeOf(inner);
      return {
        path: at,
        key,
        kind: integer ? "integer" : "number",
        optional,
        readOnly,
        min,
        max,
      };
    }

    case "ZodBoolean":
      return { path: at, key, kind: "boolean", optional, readOnly };

    case "ZodLiteral":
      return { path: at, key, kind: "literal", optional, readOnly: true };

    case "ZodEnum":
      return {
        path: at,
        key,
        kind: "enum",
        optional,
        readOnly,
        options: inner._def.values as string[],
      };

    case "ZodObject": {
      const kind = shapeKind(inner);
      if (kind !== "group") return { path: at, key, kind, optional, readOnly };
      return {
        path: at,
        key,
        kind: "group",
        optional,
        readOnly,
        fields: Object.entries((inner as z.AnyZodObject).shape).map(([k, v]) =>
          describe(k, v as z.ZodTypeAny, at),
        ),
      };
    }

    default:
      return { path: at, key, kind: "unknown", optional, readOnly: true };
  }
}

/**
 * Which group a property belongs in, and in what order.
 *
 * This is the only list of field names in the file, and it is presentational:
 * a property that is not in it still gets an editor, under "Other". So a new
 * schema field is visible and editable immediately, and moving it into a nicer
 * group is a one-line follow-up rather than a prerequisite.
 */
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "General", keys: ["Type", "Name", "UniqueId", "Location", "Width", "Height"] },
  { title: "Text", keys: ["Text", "Font", "TextColor", "TextLayout"] },
  { title: "Appearance", keys: ["Fill", "Border", "Thickness"] },
  { title: "Value", keys: ["CurrentValue", "DecimalDigits"] },
  { title: "States", keys: ["Off", "On"] },
  { title: "Geometry", keys: ["Commands", "Points"] },
];

const OPTION_BY_TYPE = new Map(
  Part._def.options.map((option) => [
    (option as z.AnyZodObject).shape.Type._def.value as string,
    option as z.AnyZodObject,
  ]),
);

/** Every part type the schema defines - which is every one the packager emits. */
export const PART_TYPES = [...OPTION_BY_TYPE.keys()];

export function fieldsOf(type: string): SchemaField[] {
  const option = OPTION_BY_TYPE.get(type);
  if (!option) return [];
  return Object.entries(option.shape).map(([key, schema]) =>
    describe(key, schema as z.ZodTypeAny, []),
  );
}

export function groupsOf(type: string): FieldGroup[] {
  const fields = fieldsOf(type);
  const placed = new Set<string>();
  const groups: FieldGroup[] = [];

  for (const group of GROUPS) {
    const members = group.keys
      .map((key) => fields.find((f) => f.key === key))
      .filter((f): f is SchemaField => f !== undefined);
    if (members.length === 0) continue;
    for (const member of members) placed.add(member.key);
    groups.push({ title: group.title, fields: members });
  }

  const rest = fields.filter((f) => !placed.has(f.key));
  if (rest.length > 0) groups.push({ title: "Other", fields: rest });

  return groups;
}

/** Reads a value out of a part by the path a SchemaField carries. */
export function valueAt(root: unknown, path: string[]): unknown {
  let node: unknown = root;
  for (const step of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[step];
  }
  return node;
}
