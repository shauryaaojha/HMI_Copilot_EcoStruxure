/**
 * Which tag types each part can be driven by, and the property that carries
 * the value. One table, read by validation (lib/validation/rules.ts) and by
 * the bindTag op (core/ops/apply.ts), so an op cannot bind what validate
 * would then call an error.
 */
import type { Part, Variable } from "@/lib/ote/schema";

/** Properties that carry a live value, by part type. */
export const VALUE_PROPERTY: Partial<Record<Part["Type"], string>> = {
  Lamp: "CurrentValue",
  NumericDisplay: "CurrentValue",
  Switch: "CurrentValue",
  "N-StateLamp": "CurrentValue",
  StringDisplay: "CurrentValue",
  ToggleSwitch: "CurrentValue",
  Pipe: "CurrentValue",
};

/** What a part can legitimately be driven by. */
export const ACCEPTS: Partial<Record<Part["Type"], Variable["DataType"][]>> = {
  Lamp: ["BOOL"],
  NumericDisplay: ["INT", "DINT", "UINT", "UDINT", "WORD", "DWORD", "REAL", "LREAL"],
  Switch: ["BOOL"],
  "N-StateLamp": ["BOOL", "INT", "DINT", "UINT", "UDINT", "WORD", "DWORD"],
  StringDisplay: ["STRING"],
  ToggleSwitch: ["BOOL"],
  Pipe: ["BOOL", "INT", "DINT", "UINT", "UDINT", "WORD", "DWORD"],
};

