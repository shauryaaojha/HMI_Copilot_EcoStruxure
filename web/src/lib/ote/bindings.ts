/**
 * The Sources -> Bindings -> Targets graph that Bindings.dat contains.
 *
 * This is the file that does the work "complex tag integration" describes: an
 * engineer wires these by hand, several hundred times, per project.
 *
 * Two kinds of binding, and they are not the same shape:
 *
 *   display  a tag drives a part property. Target ObjectType 8, SubType is the
 *            part type, BindingText carries a ".Value" suffix, Mode 2.
 *   alarm    a tag is an alarm's trigger. Target ObjectType 30, SubType
 *            BoolAlarm or LevelAlarm, TargetProperty "VariableName", the
 *            BindingText is the bare tag name, Mode 1.
 *
 * Ported from tools/make_project.py. Phase 1 of docs/BUILD_PLAN.md.
 */

import type { AlarmTarget, VariableIds } from "./databases";
import type { Part } from "./schema";

/** ObjectType 4 = variable, 8 = screen part, 30 = alarm. */
export const OBJECT_TYPE = { VARIABLE: 4, PART: 8, ALARM: 30 } as const;

export interface Source {
  ObjectType: number;
  ReferenceId: number;
  ObjectId: string;
  ObjectFullName: string;
}

export interface Target {
  ObjectType: number;
  SubType: string;
  ReferenceId: number;
  ObjectId: string;
  ParentIds?: string;
  ScreenId?: string;
  ObjectFullName: string;
}

export interface BindingRow {
  Type: number;
  Mode: number;
  BindingText: string;
  ConverterId: null;
  ConverterName: null;
  Target: number;
  TargetProperty: string;
  /** The referenceId of the source, as a string - the product's own convention. */
  Sources: string;
}

export interface BindingGraph {
  Sources: Source[];
  Targets: Target[];
  Bindings: BindingRow[];
}

/** One part property driven by one tag. */
export interface Wire {
  part: Part;
  tag: string;
  property: string;
}

export function buildGraph(
  screenId: string,
  wires: Wire[],
  variableIds: VariableIds,
  alarms: AlarmTarget[] = [],
): BindingGraph {
  const Sources: Source[] = [];
  const Targets: Target[] = [];
  const Bindings: BindingRow[] = [];

  /** One source per tag, however many things it drives. */
  const sourceIndex = new Map<string, number>();
  const sourceFor = (tag: string) => {
    const existing = sourceIndex.get(tag);
    if (existing !== undefined) return existing;

    const objectId = variableIds[tag];
    if (!objectId) {
      throw new Error(
        `binding references "${tag}", which is not in the variable list`,
      );
    }
    const referenceId = Sources.length;
    sourceIndex.set(tag, referenceId);
    Sources.push({
      ObjectType: OBJECT_TYPE.VARIABLE,
      ReferenceId: referenceId,
      ObjectId: objectId,
      ObjectFullName: tag,
    });
    return referenceId;
  };

  for (const { part, tag, property } of wires) {
    const source = sourceFor(tag);
    const target = Targets.length;
    Targets.push({
      ObjectType: OBJECT_TYPE.PART,
      SubType: part.Type,
      ReferenceId: target,
      ObjectId: part.UniqueId,
      ParentIds: screenId.toUpperCase(),
      ScreenId: screenId,
      ObjectFullName: part.Name,
    });
    Bindings.push({
      Type: 2,
      Mode: 2,
      BindingText: `${tag}.Value`,
      ConverterId: null,
      ConverterName: null,
      Target: target,
      TargetProperty: property,
      Sources: String(source),
    });
  }

  for (const alarm of alarms) {
    const source = sourceFor(alarm.trigger);
    const target = Targets.length;
    Targets.push({
      ObjectType: OBJECT_TYPE.ALARM,
      SubType: alarm.subType,
      ReferenceId: target,
      ObjectId: alarm.uid,
      ObjectFullName: alarm.fullName,
    });
    Bindings.push({
      Type: 2,
      Mode: 1,
      BindingText: alarm.trigger,
      ConverterId: null,
      ConverterName: null,
      Target: target,
      TargetProperty: "VariableName",
      Sources: String(source),
    });
  }

  return { Sources, Targets, Bindings };
}

export function isAlarmBinding(binding: BindingRow): boolean {
  return binding.TargetProperty === "VariableName";
}
