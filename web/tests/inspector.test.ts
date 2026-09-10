/**
 * Phase 5's promise, tested: "a part gains an editor the moment it gains a
 * schema".
 *
 * That only holds if the inspector derives its fields from lib/ote/schema.ts
 * rather than listing them, so these tests check the derivation against the
 * schema itself rather than against an expected list of field names. A test
 * that hardcoded "Rectangle has Fill, Border, Thickness" would pass just as
 * happily over a hand-written inspector, and would be worthless.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Part } from "@/lib/ote/schema";
import {
  PART_TYPES,
  fieldsOf,
  groupsOf,
  valueAt,
  type SchemaField,
} from "@/components/inspector/schemaFields";
import { demoScreen } from "@/fixtures";

const options = Part._def.options as z.AnyZodObject[];

function flatten(fields: SchemaField[]): SchemaField[] {
  return fields.flatMap((f) => (f.fields ? [f, ...flatten(f.fields)] : [f]));
}

describe("inspector fields come from the schema, not from a list", () => {
  it("knows every part type the union declares", () => {
    const declared = options.map((o) => o.shape.Type._def.value as string);
    expect([...PART_TYPES].sort()).toEqual([...declared].sort());
  });

  it("offers a field for every property of every part, with none invented", () => {
    for (const option of options) {
      const type = option.shape.Type._def.value as string;
      const fromSchema = Object.keys(option.shape).sort();
      const fromInspector = fieldsOf(type)
        .map((f) => f.key)
        .sort();
      expect(fromInspector, `${type} fields`).toEqual(fromSchema);
    }
  });

  it("puts every field in exactly one group", () => {
    for (const type of PART_TYPES) {
      const grouped = groupsOf(type).flatMap((g) => g.fields.map((f) => f.key));
      expect(new Set(grouped).size, `${type} has a duplicated field`).toBe(
        grouped.length,
      );
      expect(grouped.sort()).toEqual(fieldsOf(type).map((f) => f.key).sort());
    }
  });

  it("recognises a palette reference by its shape, not by its name", () => {
    // Fill, Border and TextColor are all { Color: { Value } }. So is any future
    // colour property, whatever it ends up called.
    const rect = fieldsOf("Rectangle");
    expect(rect.find((f) => f.key === "Fill")?.kind).toBe("color");
    expect(rect.find((f) => f.key === "Border")?.kind).toBe("color");
    expect(fieldsOf("TextBox").find((f) => f.key === "TextColor")?.kind).toBe("color");
  });

  it("classifies the other composite shapes structurally", () => {
    const text = fieldsOf("TextBox");
    expect(text.find((f) => f.key === "Location")?.kind).toBe("location");
    expect(text.find((f) => f.key === "Font")?.kind).toBe("font");
    expect(text.find((f) => f.key === "TextLayout")?.kind).toBe("align");
  });

  it("descends into a Lamp's two states rather than showing them as blobs", () => {
    const lamp = fieldsOf("Lamp");
    const off = lamp.find((f) => f.key === "Off");
    expect(off?.kind).toBe("group");
    // The state's own properties get their own editors, at their own paths.
    const fill = off?.fields?.find((f) => f.key === "Fill");
    expect(fill?.kind).toBe("color");
    expect(fill?.path).toEqual(["Off", "Fill"]);
  });

  it("carries the schema's numeric constraints onto the editor", () => {
    const digits = fieldsOf("NumericDisplay").find((f) => f.key === "DecimalDigits");
    expect(digits?.kind).toBe("integer");
    expect(digits?.min).toBe(0);
    expect(digits?.max).toBe(6);
  });

  it("marks identity fields read-only so they cannot be edited into nonsense", () => {
    for (const type of PART_TYPES) {
      const fields = fieldsOf(type);
      expect(fields.find((f) => f.key === "UniqueId")?.readOnly).toBe(true);
      expect(fields.find((f) => f.key === "Type")?.readOnly).toBe(true);
      expect(fields.find((f) => f.key === "Name")?.readOnly).toBe(false);
    }
  });

  it("reads a real value out of a real part at the derived path", () => {
    const lamp = demoScreen.Children[0].Children.find((p) => p.Type === "Lamp");
    expect(lamp).toBeDefined();
    const path = flatten(fieldsOf("Lamp")).find(
      (f) => f.path.join(".") === "Off.Fill",
    )!.path;
    // Whatever the fixture's Off fill is, the derived path must find it.
    expect(valueAt(lamp, path)).toEqual(
      (lamp as { Off: { Fill?: unknown } }).Off.Fill,
    );
  });

  it("survives a part type it has never seen", () => {
    expect(fieldsOf("NotAPart")).toEqual([]);
    expect(groupsOf("NotAPart")).toEqual([]);
  });
});
