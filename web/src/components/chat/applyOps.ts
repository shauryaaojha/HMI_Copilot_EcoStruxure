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
import { clampToPanel, freeSpot, type Panel } from "@/lib/ote/place";
import { CARD_SIZE, equipmentCard, type LayoutUnit } from "@/lib/ote/layout";
import { inferEquipment } from "@/lib/ai/infer";
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

/** The screen's own size, which is what a position has to fit inside. */
const panelOf = (screen: Screen): Panel => ({
  width: viewOf(screen).Width,
  height: viewOf(screen).Height,
});

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

/**
 * Where the new object goes.
 *
 * Two rules, and the difference between them matters. If the model said where,
 * it is respected - overlap is often deliberate, a label sits on the panel
 * behind it - and only pulled inside the panel, because an object placed off
 * the ViewBox is clipped by SVG and simply never appears.
 *
 * If it did not say, the position is computed from what is already on the
 * screen. This used to default to 20,20, so every object added without
 * coordinates landed on the same spot: three requests, three objects in one
 * corner on top of each other.
 */
function boxFrom(
  op: Op,
  fallback: { width: number; height: number },
  screen?: Screen,
): { left: number; top: number; width: number; height: number } {
  const size = {
    width: Math.max(1, Math.round(op.width ?? fallback.width)),
    height: Math.max(1, Math.round(op.height ?? fallback.height)),
  };
  const view = screen ? viewOf(screen) : undefined;
  const panel: Panel = view
    ? { width: view.Width, height: view.Height }
    : { width: 1024, height: 600 };

  if (op.left !== undefined && op.top !== undefined) {
    return clampToPanel({ ...size, left: op.left, top: op.top }, panel);
  }

  const taken = (view?.Children ?? []).map((part) => ({
    left: part.Location.Left,
    top: part.Location.Top,
    width: part.Width,
    height: part.Height,
  }));
  return { ...size, ...freeSpot(taken, size, panel) };
}

/**
 * The name an unnamed object gets: `Lamp_1`, `Lamp_2`, `NumericDisplay_1`.
 *
 * The convention exists because a model that omits `name` on addObject still
 * has to bind to the thing it just added, and it guesses exactly this. Naming
 * the first lamp `Lamp` instead - which is what a bare type fallback gives -
 * meant the bind in the very next op resolved to nothing, and the engineer got
 * an object with no tag on it and a line saying "no object called Lamp_1".
 */
function defaultName(type: string, screen?: Screen): string {
  const existing = screen
    ? viewOf(screen).Children.filter((p) => p.Type === type).length
    : 0;
  return `${type}_${existing + 1}`;
}

function buildPart(op: Op, screen?: Screen): Part | null {
  const name = (
    op.name ??
    op.target ??
    (op.type ? defaultName(op.type, screen) : "Object")
  ).replace(/[^A-Za-z0-9_]/g, "_");
  switch (op.type) {
    case "Rectangle":
      return rectangle(name, boxFrom(op, { width: 200, height: 120 }, screen), {
        fill: op.color ? COLOR[op.color] : undefined,
      });
    case "TextBox":
      return textBox(name, op.text ?? name, boxFrom(op, { width: 200, height: 28 }, screen), {
        size: op.fontSize,
        colour: op.color ? COLOR[op.color] : undefined,
        bold: op.bold,
      });
    case "Lamp":
      return lamp(
        name,
        op.offText ?? "OFF",
        op.onText ?? "ON",
        boxFrom(op, { width: 180, height: 64 }, screen),
      );
    case "NumericDisplay":
      return numericDisplay(
        name,
        boxFrom(op, { width: 180, height: 52 }, screen),
        op.decimals ?? 1,
      );
    case "AlarmSummary":
      return alarmSummary(name, boxFrom(op, { width: 600, height: 220 }, screen));
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

  /**
   * What this batch created, so a later op can refer to it.
   *
   * A model that adds an object without naming it still has to bind to the
   * thing it just added, and it refers to it by a name it made up - Lamp_1.
   * The real name depends on what is already on the screen, which it cannot
   * predict. Rather than guess the same way it guesses, an unresolved target
   * is matched against what this batch actually created.
   */
  const created: { name: string; type: string }[] = [];

  /** The type a made-up name implies: Lamp_1 -> Lamp, NumericDisplay_2 -> NumericDisplay. */
  const impliedType = (name: string) => name.replace(/_\d+$/, "").toLowerCase();

  /** Letters and digits only, so FAN_111_RUN and Lamp_FAN111_RUN can be compared. */
  const squash = (name: string) => name.replace(/[^a-z0-9]/gi, "").toLowerCase();

  /**
   * Finds the object an op is talking about.
   *
   * By name first, which is what the model is given and what the packager binds
   * by. Then three fallbacks, in order of how sure they are:
   *
   *   - something this batch just created, when the name it invented could only
   *     mean that;
   *   - the object a tag drives. Asked to group the fan lamps, the model
   *     answered with FAN_111_RUN - a tag, not an object - because the digest
   *     lists both and the tag is the name an engineer would say. The lamp
   *     showing that tag is unambiguously what was meant;
   *   - a name that matches once punctuation is ignored, which is how
   *     FAN_111_RUN reaches Lamp_FAN111_RUN when nothing is bound yet.
   */
  const resolve = (s: Store, name: string) => {
    const direct = findPart(s, name);
    if (direct) return direct;

    // Only when it is unambiguous: one object of that type in this batch.
    const wanted = impliedType(name);
    const candidates = created.filter((c) => c.type.toLowerCase() === wanted);
    if (candidates.length === 1) return findPart(s, candidates[0].name);

    const asTag = s.bindings.find(
      (b) => b.tag.toLowerCase() === name.trim().toLowerCase(),
    );
    if (asTag) {
      const owner = s.screens
        .flatMap((screen) => viewOf(screen).Children.map((part) => ({ part, screen })))
        .find(({ part }) => part.UniqueId === asTag.targetId);
      if (owner) return owner;
    }

    const needle = squash(name);
    const loose = s.screens
      .flatMap((screen) => viewOf(screen).Children.map((part) => ({ part, screen })))
      .filter(({ part }) => squash(part.Name).includes(needle));
    return loose.length === 1 ? loose[0] : undefined;
  };

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

      case "addEquipment": {
        const screen = findScreen(s, op.screen);
        if (!screen) {
          problems.push(`Cannot add equipment: no screen called ${op.screen}`);
          break;
        }

        // Re-inferred from the variables rather than read off the store's
        // equipment list: inference is deterministic and always available, and
        // the card needs the per-tag roles that the event contract flattens
        // away.
        const wanted = (op.equipment ?? op.target ?? "").trim().toLowerCase();
        const units = inferEquipment(s.variables) as unknown as LayoutUnit[];
        const unit = units.find(
          (u) =>
            u.id.toLowerCase() === wanted ||
            u.label.toLowerCase() === wanted ||
            u.id.replace(/[^a-z0-9]/gi, "").toLowerCase() ===
              wanted.replace(/[^a-z0-9]/gi, ""),
        );
        if (!unit) {
          problems.push(
            `No equipment called ${op.equipment ?? op.target} in the tag list.`,
          );
          break;
        }

        const view = viewOf(screen);
        const panel: Panel = { width: view.Width, height: view.Height };
        const size = {
          width: Math.min(op.width ?? CARD_SIZE.width, panel.width - 24),
          height: Math.min(op.height ?? CARD_SIZE.height, panel.height - 24),
        };
        const at =
          op.left !== undefined && op.top !== undefined
            ? clampToPanel({ ...size, left: op.left, top: op.top }, panel)
            : { ...size, ...freeSpot(
                view.Children.map((part) => ({
                  left: part.Location.Left,
                  top: part.Location.Top,
                  width: part.Width,
                  height: part.Height,
                })),
                size,
                panel,
              ) };

        const built = equipmentCard(unit, at);
        for (const part of built.parts) s.appendObject(screen.UniqueId, part);
        // appendObject renames in place, so the wires still point at the right
        // objects under whatever name they ended up with.
        for (const wire of built.wires) {
          useProject.getState().addBinding({
            tag: wire.tag,
            targetId: wire.part.UniqueId,
            targetName: wire.part.Name,
            property: wire.property,
          });
        }
        created.push(...built.parts.map((p) => ({ name: p.Name, type: p.Type })));
        changes.push(
          note ||
            `Placed ${unit.label} on ${screen.Name} — ${built.parts.length} objects, ${built.wires.length} bound`,
        );
        break;
      }

      case "addObject": {
        const screen = findScreen(s, op.screen);
        const part = buildPart(op, screen);
        if (!screen) {
          problems.push(`Cannot add ${op.type}: no screen called ${op.screen}`);
          break;
        }
        if (!part) {
          problems.push(`${op.type ?? "That"} is not a part this can place.`);
          break;
        }
        s.appendObject(screen.UniqueId, part);
        // appendObject makes the name unique, so read back what it became.
        const landed =
          viewOf(useProject.getState().screens.find((x) => x.UniqueId === screen.UniqueId)!)
            .Children.at(-1) ?? part;
        created.push({ name: landed.Name, type: landed.Type });
        changes.push(note || `Added ${landed.Type} ${landed.Name} to ${screen.Name}`);
        break;
      }

      case "moveObject": {
        const found = resolve(s, op.target!);
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        s.setBox(
          found.part.UniqueId,
          clampToPanel(
            {
              left: op.left ?? found.part.Location.Left,
              top: op.top ?? found.part.Location.Top,
              width: found.part.Width,
              height: found.part.Height,
            },
            panelOf(found.screen),
          ),
        );
        changes.push(note || `Moved ${found.part.Name}`);
        break;
      }

      case "resizeObject": {
        const found = resolve(s, op.target!);
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        s.setBox(
          found.part.UniqueId,
          clampToPanel(
            {
              left: found.part.Location.Left,
              top: found.part.Location.Top,
              width: op.width ?? found.part.Width,
              height: op.height ?? found.part.Height,
            },
            panelOf(found.screen),
          ),
        );
        changes.push(note || `Resized ${found.part.Name}`);
        break;
      }

      case "setText": {
        const found = resolve(s, op.target!);
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
        const found = resolve(s, op.target!);
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
        const found = resolve(s, op.target!);
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        s.removeObjects([found.part.UniqueId]);
        changes.push(note || `Deleted ${found.part.Name}`);
        break;
      }

      case "duplicateObject": {
        const found = resolve(s, op.target!);
        if (!found) {
          problems.push(`No object called ${op.target}`);
          break;
        }
        s.duplicateObjects([found.part.UniqueId]);
        changes.push(note || `Duplicated ${found.part.Name}`);
        break;
      }

      case "groupObjects": {
        const ids = (op.targets ?? [])
          .map((name) => resolve(s, name)?.part.UniqueId)
          .filter((id): id is string => !!id);
        const gone = (op.targets ?? []).filter((name) => !resolve(s, name));
        for (const name of gone) problems.push(`No object called ${name}`);

        if (ids.length < 2) {
          problems.push("Grouping needs at least two objects that exist.");
          break;
        }
        s.group(ids);
        s.select(ids);
        changes.push(note || `Grouped ${ids.length} objects`);
        break;
      }

      case "ungroupObjects": {
        const ids = (op.targets ?? [])
          .map((name) => resolve(s, name)?.part.UniqueId)
          .filter((id): id is string => !!id);
        if (ids.length === 0) {
          problems.push("None of those objects exist, so there was nothing to ungroup.");
          break;
        }
        s.ungroup(ids);
        changes.push(note || `Ungrouped ${ids.length} objects`);
        break;
      }

      case "alignObjects": {
        const ids = (op.targets ?? [])
          .map((name) => resolve(s, name)?.part.UniqueId)
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
        const found = resolve(s, op.target!);
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
