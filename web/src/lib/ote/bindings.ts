/**
 * The Sources -> Bindings -> Targets graph that Bindings.dat contains.
 *
 * This is the file that does the work "complex tag integration" describes: an
 * engineer wires these by hand, several hundred times, per project.
 *
 * Ported from tools/make_project.py. Phase 1 of docs/BUILD_PLAN.md.
 */

import type { Binding } from "@/store/project";

/** ObjectType 4 = variable, 8 = screen part, 30 = alarm. */
export const OBJECT_TYPE = { VARIABLE: 4, PART: 8, ALARM: 30 } as const;

export interface BindingGraph {
  Sources: {
    ObjectType: number;
    ReferenceId: number;
    ObjectId: string;
    ObjectFullName: string;
  }[];
  Targets: {
    ObjectType: number;
    SubType: string;
    ReferenceId: number;
    ObjectId: string;
    ParentIds?: string;
    ScreenId?: string;
    ObjectFullName: string;
  }[];
  Bindings: {
    Type: number;
    Mode: number;
    BindingText: string;
    ConverterId: null;
    ConverterName: null;
    Target: number;
    TargetProperty: string;
    Sources: string;
  }[];
}

/**
 * Mode 2 is a display binding (tag drives a property); Mode 1 is an alarm
 * binding (tag is the trigger, bound through VariableName). A display binding's
 * BindingText carries the ".Value" suffix; an alarm's does not.
 */
export function buildGraph(): BindingGraph {
  // TODO Phase 1: port write_bindings() from tools/make_project.py.
  // Gate: tests/packager.test.ts must produce a file OTE opens.
  throw new Error("not implemented - see docs/BUILD_PLAN.md Phase 1");
}

export function isAlarmBinding(b: Binding): boolean {
  return b.property === "VariableName";
}
