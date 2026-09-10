"use client";

/**
 * Turning the model's op list into edits on the real project.
 *
 * Every op resolves to a store action that already existed for the toolbar, so
 * a change asked for in words lands in the same undo history as a change made
 * with the mouse and is constrained by the same schema. Nothing here writes
 * into the tree directly.
 *
 * Objects and screens are addressed by Name, because that is what the model was
 * given and what the packager binds by. A name that does not resolve is
 * reported, not guessed at: "no object called Pump_3 on this screen" is a
 * better outcome than an edit to whatever was nearest.
 */

import {
  alarmSummary,
  lamp,
  numericDisplay,
  rectangle,
  textBox,
} from "@/lib/ote/parts";
import {
  AMBER,
  BLACK,
  DARK_GREEN,
  DARK_GREY,
  GREEN,
  GREY,
  INK,
  PAPER,
  RED,
  WHITE,
} from "@/lib/ote/palette";
import type { Alarm, Part, Screen } from "@/lib/ote/schema";
import type { Op } from "@/lib/ai/ops";
import { useProject } from "@/store/project";

const COLOR: Record<string, number> = {
  ink: INK,
  paper: PAPER,
  green: GREEN,
  amber: AMBER,
  red: RED,
  grey: GREY,
  white: WHITE,
  darkgrey: DARK_GREY,
  black: BLACK,
  darkgreen: DARK_GREEN,
};

export interface OpOutcome {
  /** What happened, in engineering language, for the turn's change list. */
  changes: string[];
  /** Ops that could not be applied, and why. Shown, never swallowed. */
  problems: string[];
}

type Store = ReturnType<typeof useProject.getState>;

const viewOf = (screen: Screen) => screen.Children[0];

function findScreen(s: Store, name?: string): Screen | undefined {
  if (!name) return s.screens.find((x) => x.UniqueId === s.activeScreenId) ?? s.screens[0];
  const wanted = name.trim().toLowerCase();
  return s.screens.find((x) => x.Name.toLowerCase() === wanted);
}

function findPart(s: Store, name: string): { part: Part; screen: Screen } | undefined {
  const wanted = name.trim().toLowerCase();
  for (const screen of s.screens) {
    const part = viewOf(screen).Children.find((p) => p.Name.toLowerCase() === wanted);
    if (part) return { part, screen };
  }
  return undefined;
}

/** A box with sensible defaults, because a model may give only some of four. */
function boxFrom(op: Op, fallback: { width: number; height: number }) {
  return {
    left: Math.round(op.left ?? 20),
    top: Math.round(op.top ?? 20),
    width: Math.max(1, Math.round(op.width ?? fallback.width)),
    height: Math.max(1, Math.round(op.height ?? fallback.height)),
  };
}

function buildPart(op: Op): Part | null {
  const name = (op.name ?? op.target ?? op.type ?? "Object").replace(/[^A-Za-z0-9_]/g, "_");
  switch (op.type) {
    case "Rectangle":
      return rectangle(name, boxFrom(op, { width: 200, height: 120 }), {
        fill: op.color ? COLOR[op.color] : undefined,
      });
    case "TextBox":
      return textBox(name, op.text ?? name, boxFrom(op, { width: 200, height: 28 }), {
        size: op.fontSize,
        colour: op.color ? COLOR[op.color] : undefined,
        bold: op.bold,
      });
    case "Lamp":
      return lamp(
        name,
        op.offText ?? "OFF",
        op.onText ?? "ON",
        boxFrom(op, { width: 180, height: 64 }),
      );
    case "NumericDisplay":
      return numericDisplay(
        name,
        boxFrom(op, { width: 180, height: 52 }),
        op.decimals ?? 1,
      );
    case "AlarmSummary":
      return alarmSummary(name, boxFrom(op, { width: 600, height: 220 }));
    default:
      // Path needs geometry from the shipped library, which a model cannot
      // supply - it comes from the library panel or not at all.
      return null;
  }
}

/**
 * Applies the ops in order, reading the store fresh between each one, because
 * an op can depend on what the one before it created.
 */
export function applyOps(ops: Op[]): OpOutcome {
  const changes: string[] = [];
  const problems: string[] = [];

  for (const op of ops) {
    const s = useProject.getState();
    const note = op.note?.trim();

    switch (op.op) {
      case "addScreen": {
        const id = s.addScreen(op.name ?? op.target);
        const created = useProject.getState().screens.find((x) => x.UniqueId === id);
        changes.push(note || `Added screen ${created?.Name ?? op.name}`);
        break;
      }

      case "renameScreen": {
        const screen = findScreen(s, op.screen ?? op.target);
        if (!screen || !op.name) {
          problems.push(`Cannot rename: no screen called ${op.screen ?? op.target}`);
          break;
        }
        s.renameScreen(screen.UniqueId, op.name);
        changes.push(note || `Renamed ${screen.Name} to ${op.name}`);
        break;
      }

      case "deleteScreen": {
        const screen = findScreen(s, op.screen ?? op.target);
        if (!screen) {
          problems.push(`Cannot delete: no screen called ${op.screen ?? op.target}`);
          break;
        }
        if (s.screens.length <= 1) {
          problems.push("A project needs at least one screen, so this one stays.");
          break;
        }
        s.removeScreen(screen.UniqueId);
        changes.push(note || `Deleted screen ${screen.Name}`);
        break;
      }

      case "addObject": {
        const screen = findScreen(s, op.screen);
        const part = buildPart(op);
        if (!screen) {
          problems.push(`Cannot add ${op.type}: no screen called ${op.screen}`);
          break;
        }
        if (!part) {
          problems.push(`${op.type ?? "That"} is not a part this can place.`);
          break;
        }
        s.appendObject(screen.UniqueId, part);
        changes.push(note || `Added ${part.Type} ${part.Name} to ${screen.Name}`);
        break;
      }

      case "moveObject": {
        const found = findPart(s, op.target!);
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        s.setBox(found.part.UniqueId, {
          left: Math.round(op.left ?? found.part.Location.Left),
          top: Math.round(op.top ?? found.part.Location.Top),
          width: found.part.Width,
          height: found.part.Height,
        });
        changes.push(note || `Moved ${found.part.Name}`);
        break;
      }

      case "resizeObject": {
        const found = findPart(s, op.target!);
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        s.setBox(found.part.UniqueId, {
          left: found.part.Location.Left,
          top: found.part.Location.Top,
          width: Math.max(1, Math.round(op.width ?? found.part.Width)),
          height: Math.max(1, Math.round(op.height ?? found.part.Height)),
        });
        changes.push(note || `Resized ${found.part.Name}`);
        break;
      }

      case "setText": {
        const found = findPart(s, op.target!);
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        const { part } = found;
        if (part.Type === "TextBox") s.setProperty(part.UniqueId, ["Text"], op.text ?? "");
        else if (part.Type === "Lamp") {
          if (op.offText !== undefined) s.setProperty(part.UniqueId, ["Off", "Text"], op.offText);
          if (op.onText !== undefined) s.setProperty(part.UniqueId, ["On", "Text"], op.onText);
          if (op.text !== undefined && op.offText === undefined && op.onText === undefined) {
            s.setProperty(part.UniqueId, ["On", "Text"], op.text);
          }
        } else {
          problems.push(`${part.Name} is a ${part.Type} and carries no text.`);
          break;
        }
        changes.push(note || `Relabelled ${part.Name}`);
        break;
      }

      case "setColor": {
        const found = findPart(s, op.target!);
        const value = op.color ? COLOR[op.color] : undefined;
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        if (value === undefined) {
          problems.push(`${op.color ?? "That"} is not a colour in the palette.`);
          break;
        }
        const key =
          op.colorRole === "border" ? "Border" : op.colorRole === "text" ? "TextColor" : "Fill";
        s.setProperty(found.part.UniqueId, [key, "Color", "Value"], value);
        changes.push(note || `Set ${found.part.Name} ${op.colorRole ?? "fill"} to ${op.color}`);
        break;
      }

      case "deleteObject": {
        const found = findPart(s, op.target!);
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        s.removeObjects([found.part.UniqueId]);
        changes.push(note || `Deleted ${found.part.Name}`);
        break;
      }

      case "duplicateObject": {
        const found = findPart(s, op.target!);
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        s.duplicateObjects([found.part.UniqueId]);
        changes.push(note || `Duplicated ${found.part.Name}`);
        break;
      }

      case "alignObjects": {
        const ids = (op.targets ?? [])
          .map((name) => findPart(s, name)?.part.UniqueId)
          .filter((id): id is string => !!id);
        if (ids.length === 0) {
          problems.push("None of those objects exist, so there was nothing to align.");
          break;
        }
        if (op.mode === "spreadHorizontal") s.spread(ids, "horizontal");
        else if (op.mode === "spreadVertical") s.spread(ids, "vertical");
        else s.align(ids, (op.mode ?? "left") as "left");
        changes.push(note || `Aligned ${ids.length} objects`);
        break;
      }

      case "bindTag": {
        const found = findPart(s, op.target!);
        const tag = s.variables.find(
          (v) => v.Name.toLowerCase() === (op.tag ?? "").trim().toLowerCase(),
        );
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        if (!tag) {
          problems.push(`${op.tag} is not in the tag list, so nothing was bound.`);
          break;
        }
        s.addBinding({
          tag: tag.Name,
          targetId: found.part.UniqueId,
          targetName: found.part.Name,
          property: op.property ?? "CurrentValue",
        });
        changes.push(note || `Bound ${tag.Name} to ${found.part.Name}`);
        break;
      }

      case "addAlarm": {
        const tag = s.variables.find(
          (v) => v.Name.toLowerCase() === (op.tag ?? "").trim().toLowerCase(),
        );
        if (!tag) {
          problems.push(`${op.tag} is not in the tag list, so no alarm was added.`);
          break;
        }
        const level = [1, 2, 3, 4].includes(op.alarmType ?? 0) ? op.alarmType! : 2;
        const kind = op.alarmKind === 1 || tag.DataType === "BOOL" ? 1 : 2;
        const alarm: Alarm = {
          Message: op.message ?? `${tag.Name} alarm`,
          Trigger: tag.Name,
          AlarmType: level as 1 | 2 | 3 | 4,
          AlarmRecordType: kind as 1 | 2,
          Severity: Math.min(9, Math.max(1, Math.round(op.severity ?? 5))),
          Value: kind === 2 ? (op.value ?? "0") : "",
        };
        s.addAlarm(alarm);
        changes.push(note || `Added alarm "${alarm.Message}" on ${tag.Name}`);
        break;
      }
    }
  }

  return { changes, problems };
}
