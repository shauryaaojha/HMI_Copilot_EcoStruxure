/**
 * Turning the model's op list into edits on a project - any project store,
 * which is what makes a dry run possible.
 *
 * Every op resolves to a store action that already existed for the toolbar,
 * so a change asked for in words is constrained by the same schema as a
 * change made with the mouse. Nothing here writes into the tree directly.
 *
 * Three rules, all from docs/LLD.md:
 *
 *   F2  Objects and screens are addressed by handle (o12, s2) or exact name.
 *       An unresolved reference is rejected with the nearest handles named,
 *       never matched by substring to whatever was closest.
 *   F3  A new object goes where a slot says - a region, or beside an anchor -
 *       and the layout engine finds the box or refuses. Coordinates are only
 *       honoured on moveObject, for the engineer who typed a number.
 *   F7  `dryRun` runs the ops on a scratch store and returns the outcome and
 *       the resulting slice; `commit` lands that slice as one undo step.
 *       The live project is untouched until then.
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
import { clampToPanel } from "@/lib/ote/place";
import { boxOf, panelOf, resolveSlot, type Box, type Slot } from "@/lib/ote/regions";
import { CARD_SIZE, equipmentCard, type LayoutUnit } from "@/lib/ote/layout";
import { inferEquipment } from "@/lib/ai/infer";
import type { Op } from "@/lib/ai/ops";
import { createProjectStore, useProject, type BatchPatch, type ProjectStore } from "@/store/project";

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

export interface Rejection {
  op: Op;
  reason: string;
}

export interface OpOutcome {
  /** What happened, one line per op, in engineering language. */
  applied: string[];
  /** Ops that could not be applied, and why. Shown, never swallowed. */
  rejected: Rejection[];
  /** Objects this batch created: handle, the name it landed with, its type. */
  created: { handle: string; name: string; type: string; screen: string }[];
  /** Names the model asked for that the store had to change. */
  renamed: { asked: string; became: string; handle: string }[];
  /** Handles of everything this batch touched, created or not. */
  touched: string[];
  /** Whether anything was deleted - a proposal, never an auto-commit. */
  deleted: boolean;

  /** Legacy shape, kept for the tests and the turn's change list. */
  changes: string[];
  problems: string[];
}

type State = ReturnType<ProjectStore["getState"]>;

const viewOf = (screen: Screen) => screen.Children[0];

const HANDLE = /^[os]\d+$/i;

/** UniqueId → handle, or a placeholder for something that has none yet. */
export const handleOf = (s: State, id: string) => s.handles[id] ?? "?";

function findScreen(s: State, ref?: string): Screen | undefined {
  if (!ref) return s.screens.find((x) => x.UniqueId === s.activeScreenId) ?? s.screens[0];
  const wanted = ref.trim().toLowerCase();
  if (HANDLE.test(wanted)) {
    const id = Object.entries(s.handles).find(([, h]) => h.toLowerCase() === wanted)?.[0];
    if (id) return s.screens.find((x) => x.UniqueId === id);
  }
  return s.screens.find((x) => x.Name.toLowerCase() === wanted);
}

function findPartById(s: State, id: string): { part: Part; screen: Screen } | undefined {
  for (const screen of s.screens) {
    const part = viewOf(screen).Children.find((p) => p.UniqueId === id);
    if (part) return { part, screen };
  }
  return undefined;
}

function findPartByName(s: State, name: string): { part: Part; screen: Screen } | undefined {
  const wanted = name.trim().toLowerCase();
  for (const screen of s.screens) {
    const part = viewOf(screen).Children.find((p) => p.Name.toLowerCase() === wanted);
    if (part) return { part, screen };
  }
  return undefined;
}

/** Edit distance, for naming the nearest handles in a rejection. */
function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

function nearest(s: State, ref: string, count = 3): string[] {
  const wanted = ref.toLowerCase();
  return s.screens
    .flatMap((screen) => viewOf(screen).Children)
    .map((p) => ({ p, d: distance(wanted, p.Name.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map(({ p }) => `${handleOf(s, p.UniqueId)} ${p.Name}`);
}

/**
 * The name an unnamed object gets: `Lamp_1`, `Lamp_2`, `NumericDisplay_1`.
 * A model that omits `name` still has to bind to what it added, and this is
 * what it guesses.
 */
function defaultName(type: string, screen?: Screen): string {
  const existing = screen ? viewOf(screen).Children.filter((p) => p.Type === type).length : 0;
  return `${type}_${existing + 1}`;
}

const sizeFor = (type: Op["type"]): { width: number; height: number } => {
  switch (type) {
    case "Rectangle":
      return { width: 200, height: 120 };
    case "TextBox":
      return { width: 200, height: 28 };
    case "Lamp":
      return { width: 180, height: 64 };
    case "NumericDisplay":
      return { width: 180, height: 52 };
    case "AlarmSummary":
      return { width: 600, height: 220 };
    default:
      return { width: 200, height: 100 };
  }
};

function buildPart(op: Op, name: string, box: Box): Part | null {
  switch (op.type) {
    case "Rectangle":
      return rectangle(name, box, { fill: op.color ? COLOR[op.color] : undefined });
    case "TextBox":
      return textBox(name, op.text ?? name, box, {
        size: op.fontSize,
        colour: op.color ? COLOR[op.color] : undefined,
        bold: op.bold,
      });
    case "Lamp":
      return lamp(name, op.offText ?? "OFF", op.onText ?? "ON", box);
    case "NumericDisplay":
      return numericDisplay(name, box, op.decimals ?? 1);
    case "AlarmSummary":
      return alarmSummary(name, box);
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
export function applyOps(ops: Op[], store: ProjectStore = useProject): OpOutcome {
  const out: OpOutcome = {
    applied: [],
    rejected: [],
    created: [],
    renamed: [],
    touched: [],
    deleted: false,
    changes: [],
    problems: [],
  };
  const ok = (line: string) => {
    out.applied.push(line);
    out.changes.push(line);
  };
  const reject = (op: Op, reason: string) => {
    out.rejected.push({ op, reason });
    out.problems.push(reason);
  };
  const touch = (s: State, id: string) => {
    const h = handleOf(s, id);
    if (!out.touched.includes(h)) out.touched.push(h);
  };

  /**
   * What this batch created, by the name the model asked for and by type, so
   * a later op in the same batch can refer to it before knowing its handle.
   */
  const created: { asked?: string; name: string; type: string; id: string }[] = [];
  const impliedType = (name: string) => name.replace(/_\d+$/, "").toLowerCase();

  /**
   * Finds the object an op is talking about. Exact only:
   *   - a handle, o12;
   *   - an exact name;
   *   - the name the model gave something it created earlier in this batch;
   *   - the one object of a type created in this batch, when the reference is
   *     that type plus a number and nothing else matches;
   *   - the one object a named tag is bound to.
   * Anything else is unresolved, and the rejection names the nearest handles.
   */
  const resolve = (s: State, ref: string) => {
    const wanted = ref.trim().toLowerCase();
    if (HANDLE.test(wanted)) {
      const id = Object.entries(s.handles).find(([, h]) => h.toLowerCase() === wanted)?.[0];
      if (id) return findPartById(s, id);
    }
    const direct = findPartByName(s, ref);
    if (direct) return direct;

    const asked = created.find((c) => c.asked?.toLowerCase() === wanted);
    if (asked) return findPartById(s, asked.id);

    const ofType = created.filter((c) => c.type.toLowerCase() === impliedType(wanted));
    if (ofType.length === 1 && /_\d+$/.test(wanted)) return findPartById(s, ofType[0].id);

    const bound = s.bindings.filter((b) => b.tag.toLowerCase() === wanted);
    if (bound.length === 1) return findPartById(s, bound[0].targetId);

    return undefined;
  };

  const unresolved = (s: State, ref: string) => {
    const near = nearest(s, ref);
    return `No object called ${ref}` + (near.length ? `; nearest: ${near.join(", ")}` : "");
  };

  /** A slot for a new or moved object, with the anchor resolved. */
  const slotFor = (
    s: State,
    op: Op,
    screen: Screen,
    size: { width: number; height: number },
    exceptId?: string,
  ) => {
    const place: Slot = op.place ?? {};
    let anchorBox: Box | undefined;
    let anchorId: string | undefined;
    if (place.anchor) {
      const found = resolve(s, place.anchor);
      if (!found) return { ok: false as const, reason: unresolved(s, place.anchor) };
      anchorBox = boxOf(found.part);
      anchorId = found.part.UniqueId;
      if (found.screen.UniqueId !== screen.UniqueId) {
        return { ok: false as const, reason: `${place.anchor} is on ${found.screen.Name}, not ${screen.Name}` };
      }
    }
    return resolveSlot(
      { ...place, side: place.side ?? (place.anchor ? "rightOf" : undefined) },
      viewOf(screen).Children,
      panelOf(screen),
      size,
      { anchorBox, anchorId, screenLabel: `${handleOf(s, screen.UniqueId)} ${screen.Name}`, exceptId },
    );
  };

  for (const op of ops) {
    const s = store.getState();
    const note = op.note?.trim();

    switch (op.op) {
      case "addScreen": {
        const id = s.addScreen(op.name ?? op.target);
        const after = store.getState();
        const screen = after.screens.find((x) => x.UniqueId === id)!;
        touch(after, id);
        ok(note || `Added screen ${handleOf(after, id)} ${screen.Name}`);
        break;
      }

      case "renameScreen": {
        const screen = findScreen(s, op.screen ?? op.target);
        if (!screen || !op.name) {
          reject(op, `Cannot rename: no screen called ${op.screen ?? op.target}`);
          break;
        }
        s.renameScreen(screen.UniqueId, op.name);
        touch(s, screen.UniqueId);
        ok(note || `Renamed ${screen.Name} to ${op.name}`);
        break;
      }

      case "deleteScreen": {
        const screen = findScreen(s, op.screen ?? op.target);
        if (!screen) {
          reject(op, `Cannot delete: no screen called ${op.screen ?? op.target}`);
          break;
        }
        if (s.screens.length <= 1) {
          reject(op, "A project needs at least one screen, so this one stays.");
          break;
        }
        s.removeScreen(screen.UniqueId);
        out.deleted = true;
        ok(note || `Deleted screen ${screen.Name}`);
        break;
      }

      case "addEquipment": {
        const screen = findScreen(s, op.screen);
        if (!screen) {
          reject(op, `Cannot add equipment: no screen called ${op.screen}`);
          break;
        }
        // Re-inferred from the variables rather than read off the store's
        // equipment list: inference is deterministic and always available.
        const wanted = (op.equipment ?? op.target ?? "").trim().toLowerCase();
        const units = inferEquipment(s.variables) as unknown as LayoutUnit[];
        const unit = units.find(
          (u) =>
            u.id.toLowerCase() === wanted ||
            u.label.toLowerCase() === wanted ||
            u.id.replace(/[^a-z0-9]/gi, "").toLowerCase() === wanted.replace(/[^a-z0-9]/gi, ""),
        );
        if (!unit) {
          reject(op, `No equipment called ${op.equipment ?? op.target} in the tag list.`);
          break;
        }

        const panel = panelOf(screen);
        const size = {
          width: Math.min(op.width ?? CARD_SIZE.width, panel.width - 24),
          height: Math.min(op.height ?? CARD_SIZE.height, panel.height - 24),
        };
        const slot = slotFor(s, op, screen, size);
        if (!slot.ok) {
          reject(op, slot.reason);
          break;
        }

        const built = equipmentCard(unit, slot.box);
        for (const part of built.parts) s.appendObject(screen.UniqueId, part);
        const after = store.getState();
        for (const wire of built.wires) {
          after.addBinding({
            tag: wire.tag,
            targetId: wire.part.UniqueId,
            targetName: wire.part.Name,
            property: wire.property,
          });
        }
        for (const part of built.parts) {
          const h = handleOf(after, part.UniqueId);
          created.push({ name: part.Name, type: part.Type, id: part.UniqueId });
          out.created.push({ handle: h, name: part.Name, type: part.Type, screen: handleOf(after, screen.UniqueId) });
          touch(after, part.UniqueId);
        }
        ok(
          note ||
            `Placed ${unit.label} in the ${slot.region} of ${screen.Name} — ${built.parts.length} objects, ${built.wires.length} bound`,
        );
        break;
      }

      case "addObject": {
        const screen = findScreen(s, op.screen);
        if (!screen) {
          reject(op, `Cannot add ${op.type}: no screen called ${op.screen}`);
          break;
        }
        if (!op.type) {
          reject(op, "addObject needs a part type.");
          break;
        }
        const askedName = op.name ?? op.target;
        const name = (askedName ?? defaultName(op.type, screen)).replace(/[^A-Za-z0-9_]/g, "_");
        const size = {
          width: Math.max(1, Math.round(op.width ?? sizeFor(op.type).width)),
          height: Math.max(1, Math.round(op.height ?? sizeFor(op.type).height)),
        };

        let box: Box;
        let region = "body";
        if (op.left !== undefined && op.top !== undefined) {
          // Explicit numbers: the engineer's choice. Kept inside the panel and
          // otherwise respected - overlap is theirs to decide.
          box = clampToPanel({ ...size, left: op.left, top: op.top }, panelOf(screen));
        } else {
          const slot = slotFor(s, op, screen, size);
          if (!slot.ok) {
            reject(op, slot.reason);
            break;
          }
          box = slot.box;
          region = slot.region;
        }

        const part = buildPart(op, name, box);
        if (!part) {
          reject(op, `${op.type} is not a part this can place.`);
          break;
        }
        s.appendObject(screen.UniqueId, part);
        const after = store.getState();
        const landed = viewOf(after.screens.find((x) => x.UniqueId === screen.UniqueId)!).Children.at(-1) ?? part;
        const h = handleOf(after, landed.UniqueId);
        created.push({ asked: askedName, name: landed.Name, type: landed.Type, id: landed.UniqueId });
        out.created.push({ handle: h, name: landed.Name, type: landed.Type, screen: handleOf(after, screen.UniqueId) });
        if (askedName && landed.Name !== askedName) out.renamed.push({ asked: askedName, became: landed.Name, handle: h });
        touch(after, landed.UniqueId);
        ok(note || `Added ${landed.Type} ${h} ${landed.Name} in the ${region} of ${screen.Name}`);
        break;
      }

      case "moveObject": {
        const found = resolve(s, op.target!);
        if (!found) {
          reject(op, unresolved(s, op.target!));
          break;
        }
        const size = { width: found.part.Width, height: found.part.Height };
        let box: Box;
        if (op.left !== undefined || op.top !== undefined) {
          box = clampToPanel(
            {
              ...size,
              left: op.left ?? found.part.Location.Left,
              top: op.top ?? found.part.Location.Top,
            },
            panelOf(found.screen),
          );
        } else if (op.place) {
          const slot = slotFor(s, op, found.screen, size, found.part.UniqueId);
          if (!slot.ok) {
            reject(op, slot.reason);
            break;
          }
          box = slot.box;
        } else {
          reject(op, `moveObject ${op.target} says neither where nor beside what.`);
          break;
        }
        s.setBox(found.part.UniqueId, box);
        touch(s, found.part.UniqueId);
        ok(note || `Moved ${handleOf(s, found.part.UniqueId)} ${found.part.Name}`);
        break;
      }

      case "resizeObject": {
        const found = resolve(s, op.target!);
        if (!found) {
          reject(op, unresolved(s, op.target!));
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
        touch(s, found.part.UniqueId);
        ok(note || `Resized ${found.part.Name}`);
        break;
      }

      case "setText": {
        const found = resolve(s, op.target!);
        if (!found) {
          reject(op, unresolved(s, op.target!));
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
          reject(op, `${part.Name} is a ${part.Type} and carries no text.`);
          break;
        }
        touch(s, part.UniqueId);
        ok(note || `Relabelled ${part.Name}`);
        break;
      }

      case "setColor": {
        const found = resolve(s, op.target!);
        const value = op.color ? COLOR[op.color] : undefined;
        if (!found) {
          reject(op, unresolved(s, op.target!));
          break;
        }
        if (value === undefined) {
          reject(op, `${op.color ?? "That"} is not a colour in the palette.`);
          break;
        }
        const key = op.colorRole === "border" ? "Border" : op.colorRole === "text" ? "TextColor" : "Fill";
        s.setProperty(found.part.UniqueId, [key, "Color", "Value"], value);
        touch(s, found.part.UniqueId);
        ok(note || `Set ${found.part.Name} ${op.colorRole ?? "fill"} to ${op.color}`);
        break;
      }

      case "deleteObject": {
        const found = resolve(s, op.target!);
        if (!found) {
          reject(op, unresolved(s, op.target!));
          break;
        }
        touch(s, found.part.UniqueId);
        s.removeObjects([found.part.UniqueId]);
        out.deleted = true;
        ok(note || `Deleted ${found.part.Name}`);
        break;
      }

      case "duplicateObject": {
        const found = resolve(s, op.target!);
        if (!found) {
          reject(op, unresolved(s, op.target!));
          break;
        }
        s.duplicateObjects([found.part.UniqueId]);
        const after = store.getState();
        for (const id of after.selectedIds) {
          const copy = findPartById(after, id);
          if (!copy) continue;
          created.push({ name: copy.part.Name, type: copy.part.Type, id });
          out.created.push({ handle: handleOf(after, id), name: copy.part.Name, type: copy.part.Type, screen: handleOf(after, copy.screen.UniqueId) });
          touch(after, id);
        }
        ok(note || `Duplicated ${found.part.Name}`);
        break;
      }

      case "groupObjects": {
        const ids = (op.targets ?? [])
          .map((name) => resolve(s, name)?.part.UniqueId)
          .filter((id): id is string => !!id);
        for (const name of (op.targets ?? []).filter((n) => !resolve(s, n))) {
          reject(op, unresolved(s, name));
        }
        if (ids.length < 2) {
          reject(op, "Grouping needs at least two objects that exist.");
          break;
        }
        s.group(ids);
        s.select(ids);
        for (const id of ids) touch(s, id);
        ok(note || `Grouped ${ids.length} objects`);
        break;
      }

      case "ungroupObjects": {
        const ids = (op.targets ?? [])
          .map((name) => resolve(s, name)?.part.UniqueId)
          .filter((id): id is string => !!id);
        if (ids.length === 0) {
          reject(op, "None of those objects exist, so there was nothing to ungroup.");
          break;
        }
        s.ungroup(ids);
        for (const id of ids) touch(s, id);
        ok(note || `Ungrouped ${ids.length} objects`);
        break;
      }

      case "alignObjects": {
        const ids = (op.targets ?? [])
          .map((name) => resolve(s, name)?.part.UniqueId)
          .filter((id): id is string => !!id);
        if (ids.length === 0) {
          reject(op, "None of those objects exist, so there was nothing to align.");
          break;
        }
        if (op.mode === "spreadHorizontal") s.spread(ids, "horizontal");
        else if (op.mode === "spreadVertical") s.spread(ids, "vertical");
        else s.align(ids, (op.mode ?? "left") as "left");
        for (const id of ids) touch(s, id);
        ok(note || `Aligned ${ids.length} objects`);
        break;
      }

      case "bindTag": {
        const found = resolve(s, op.target!);
        const tag = s.variables.find((v) => v.Name.toLowerCase() === (op.tag ?? "").trim().toLowerCase());
        if (!found) {
          reject(op, unresolved(s, op.target!));
          break;
        }
        if (!tag) {
          reject(op, `${op.tag} is not in the tag list, so nothing was bound.`);
          break;
        }
        s.addBinding({
          tag: tag.Name,
          targetId: found.part.UniqueId,
          targetName: found.part.Name,
          property: op.property ?? "CurrentValue",
        });
        touch(s, found.part.UniqueId);
        ok(note || `Bound ${tag.Name} to ${handleOf(s, found.part.UniqueId)} ${found.part.Name}`);
        break;
      }

      case "addAlarm": {
        const tag = s.variables.find((v) => v.Name.toLowerCase() === (op.tag ?? "").trim().toLowerCase());
        if (!tag) {
          reject(op, `${op.tag} is not in the tag list, so no alarm was added.`);
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
        ok(note || `Added alarm "${alarm.Message}" on ${tag.Name}`);
        break;
      }
    }
  }

  return out;
}

/* ---------------------------------------------------------------------- */
/* Dry run and commit                                                      */
/* ---------------------------------------------------------------------- */

/** The slice a scratch store needs to behave like the live one. */
function seedFrom(s: State) {
  return {
    id: s.id,
    name: s.name,
    target: s.target,
    screens: structuredClone(s.screens),
    activeScreenId: s.activeScreenId,
    variables: s.variables,
    alarms: structuredClone(s.alarms),
    bindings: structuredClone(s.bindings),
    equipment: s.equipment,
    objectMeta: structuredClone(s.objectMeta),
    screenPlacement: structuredClone(s.screenPlacement),
    handles: { ...s.handles },
    handleSeq: s.handleSeq,
    selectedIds: [...s.selectedIds],
    standards: s.standards,
  };
}

export interface DryRun {
  outcome: OpOutcome;
  /** The editable slice after the ops, ready for commitBatch. */
  patch: BatchPatch;
  /** The scratch store, for anything that wants to inspect the result. */
  scratch: ProjectStore;
}

/**
 * Runs the ops on a copy. The live project does not change; the caller
 * decides whether to commit, ask the model to repair, or show a proposal.
 */
export function dryRun(ops: Op[], live: ProjectStore = useProject): DryRun {
  const scratch = createProjectStore();
  scratch.setState(seedFrom(live.getState()));
  const outcome = applyOps(ops, scratch);
  const s = scratch.getState();
  return {
    outcome,
    scratch,
    patch: {
      screens: s.screens,
      objectMeta: s.objectMeta,
      screenPlacement: s.screenPlacement,
      activeScreenId: s.activeScreenId,
      selectedIds: s.selectedIds,
      bindings: s.bindings,
      alarms: s.alarms,
      handles: s.handles,
      handleSeq: s.handleSeq,
    },
  };
}

/** Lands a dry run on the live project as one undo step. */
export function commit(run: DryRun, label: string, live: ProjectStore = useProject) {
  live.getState().commitBatch(label, run.patch);
}
