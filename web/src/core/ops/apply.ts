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

import { COMPOSITES, isCompositeKind, propsFor } from "@/lib/composites";
import {
  FONT,
  alarmSummary,
  barScale,
  blockTrend,
  dateTimeDisplay,
  lamp,
  nStateLamp,
  numericDisplay,
  pipe,
  rectangle,
  stringDisplay,
  switchPart,
  textBox,
  toggleSwitch,
  trendGraph,
} from "@/lib/ote/parts";
import {
  AMBER,
  BLACK,
  BLUE,
  BROWN,
  CHARCOAL,
  DARK_BLUE,
  DARK_BROWN,
  DARK_GREEN,
  DARK_GREY,
  GREEN,
  GREY,
  INK,
  LIGHT_BLUE,
  NAVY,
  ORANGE,
  PAPER,
  PURPLE,
  RED,
  TAN,
  TEAL,
  WHITE,
  YELLOW,
} from "@/lib/ote/palette";
import { sizeOf } from "@/lib/ote/schema";
import type { Alarm, Part, Screen } from "@/lib/ote/schema";
import { clampToPanel } from "@/lib/ote/place";
import { boxOf, panelOf, resolveSlot, type Box, type Slot } from "@/lib/ote/regions";
import { CARD_SIZE, equipmentCard, type LayoutUnit } from "@/lib/ote/layout";
import { inferEquipment } from "@/lib/ai/infer";
import type { Op } from "./ops";
import { valuePropertyOf } from "@/lib/tags/binder";
import { expandOps } from "@/lib/ai/expand";
import { DEFAULT_THEME, isComponentKind } from "@/lib/components";
import { componentUse, sizeOfUse } from "@/lib/components/place";
import { moveSetOf, planTidy, unitsOf } from "@/lib/ote/tidy";
import { matchSizes, snapPosition } from "@/store/edits";
import { sceneOf } from "@/lib/layout/scene";
import { solveLayout } from "@/lib/layout/solve";
import { verifyPlan } from "@/lib/layout/verify";
import type { Constraint } from "@/lib/layout/types";
import { createProjectStore, sameCondition, useProject, type BatchPatch, type ProjectStore } from "@/store/project";
import type { ScreenPreview } from "@/store/types";

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
  blue: BLUE,
  darkblue: DARK_BLUE,
  navy: NAVY,
  lightblue: LIGHT_BLUE,
  teal: TEAL,
  brown: BROWN,
  darkbrown: DARK_BROWN,
  tan: TAN,
  yellow: YELLOW,
  orange: ORANGE,
  purple: PURPLE,
  charcoal: CHARCOAL,
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

/** By name; on the screen the op named first, so a namesake elsewhere is not edited instead (S1-09). */
function findPartByName(s: State, name: string, screenRef?: string): { part: Part; screen: Screen } | undefined {
  const wanted = name.trim().toLowerCase();
  const named = screenRef ? findScreen(s, screenRef) : undefined;
  for (const screen of named ? [named, ...s.screens] : s.screens) {
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
  if (type && isCompositeKind(type)) return COMPOSITES[type].size;
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
    case "Switch":
      return { width: 120, height: 48 };
    case "N-StateLamp":
      return { width: 160, height: 48 };
    case "StringDisplay":
      return { width: 200, height: 36 };
    case "ToggleSwitch":
      return { width: 140, height: 56 };
    case "BarScale":
      return { width: 40, height: 160 };
    case "Pipe":
      return { width: 160, height: 12 };
    case "DateTimeDisplay":
      return { width: 180, height: 32 };
    case "TrendGraph":
    case "BlockTrend":
      return { width: 420, height: 220 };
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
    case "Switch":
      return switchPart(name, op.text ?? "START", box);
    case "N-StateLamp": {
      // "states" arrive as the lamp texts in order: offText, onText, then any
      // more in `text` separated by commas - STOPPED, RUNNING, FAULT.
      const listed = (op.text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const states = [op.offText, op.onText, ...listed].filter((s): s is string => !!s);
      return nStateLamp(name, states.length >= 2 ? states : listed.length >= 2 ? listed : ["STOPPED", "RUNNING", "FAULT"], box);
    }
    case "StringDisplay":
      return stringDisplay(name, box);
    case "ToggleSwitch":
      return toggleSwitch(name, op.offText ?? "OFF", op.onText ?? "ON", box);
    case "BarScale":
      return barScale(name, box);
    case "Pipe":
      return pipe(name, box);
    case "DateTimeDisplay":
      return dateTimeDisplay(name, box);
    case "TrendGraph":
    case "BlockTrend": {
      // A trend names its tags inline: the op's tag for one, or its text as
      // a comma-separated list - "FT_101_PV, PT_101_PV".
      const listed = (op.text ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      const tags = [op.tag, ...listed].filter((t): t is string => !!t);
      return op.type === "TrendGraph" ? trendGraph(name, tags, box) : blockTrend(name, tags, box);
    }
    default:
      // Path needs geometry from the shipped library, which a model cannot
      // supply - it comes from the library panel or not at all.
      return null;
  }
}

/**
 * The declared tag an op means. `tag` when the model filled it in. A small
 * model sometimes leaves `tag` empty and writes the name into another field
 * instead ("addAlarm", target "TNK_101_LEVEL"), so the op's other text is
 * searched for a declared tag name, whole and exact. One candidate resolves;
 * none or several resolve to nothing, and the op is rejected as before.
 */
export function tagOf<V extends { Name: string }>(variables: V[], op: Op, others: (string | undefined)[]): V | undefined {
  const asked = (op.tag ?? "").trim().toLowerCase();
  if (asked) return variables.find((v) => v.Name.toLowerCase() === asked);
  // Words as a tag name spells them: letters, digits, _ . [ ] (A[0].B).
  const words = new Set(
    others.join(" ").split(/[^A-Za-z0-9_.[\]]+/).map((w) => w.replace(/\.+$/, "").toLowerCase()).filter(Boolean),
  );
  const named = variables.filter((v) => words.has(v.Name.toLowerCase()));
  return named.length === 1 ? named[0] : undefined;
}

/** Why an op that needed a tag got none. */
const noTag = (op: Op, outcome: string) =>
  op.tag?.trim()
    ? `${op.tag} is not in the tag list, so ${outcome}.`
    : `No tag was named, so ${outcome}. Name one from the tag list.`;

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
  /**
   * A fanned-out op (lib/ai/expand.ts) repeats the model's note on every
   * object it reached. The turn reads one line for it with the count, not
   * thirteen copies of "set the title to 20 pt".
   */
  let currentNote: string | undefined;
  /** The screen the current op names, if any: where its object names are looked up first. */
  let currentScreen: string | undefined;
  /** Screens a tidyLayout looked at, and how many had anything to move. */
  const tidied = { screens: 0, found: 0 };
  const firstLine = new Map<string, { at: number; line: string; count: number }>();
  const ok = (line: string) => {
    const seen = currentNote ? firstLine.get(currentNote) : undefined;
    if (seen) {
      seen.count++;
      return;
    }
    if (currentNote) firstLine.set(currentNote, { at: out.applied.length, line, count: 1 });
    out.applied.push(line);
    out.changes.push(line);
  };
  /** The same for refusals: one line, and how many screens it was refused on. */
  const firstRefusal = new Map<string, { at: number; count: number }>();
  const reject = (op: Op, reason: string) => {
    const seen = currentNote ? firstRefusal.get(currentNote) : undefined;
    if (seen) {
      seen.count++;
      return;
    }
    if (currentNote) firstRefusal.set(currentNote, { at: out.rejected.length, count: 1 });
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
    const direct = findPartByName(s, ref, currentScreen);
    if (direct) return direct;

    const asked = created.find((c) => c.asked?.toLowerCase() === wanted);
    if (asked) return findPartById(s, asked.id);

    // A handle that does not exist, in a batch that created exactly one
    // object: the model guessed the handle its own add would get. The
    // recorded sessions do this on every "add and bind" request.
    if (HANDLE.test(wanted) && created.length === 1) return findPartById(s, created[0].id);

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

  // Scope first: an op for "all screens" or "every lamp" becomes one plain op
  // per object, each naming its object by handle (lib/ai/expand.ts).
  const expansion = expandOps(ops, store.getState());
  for (const r of expansion.rejected) reject(r.op, r.reason);
  for (const op of expansion.ops) {
    const s = store.getState();
    const note = op.note?.trim();
    // A tidy reports per screen what it moved; those lines are not repeats.
    currentNote = note && op.op !== "tidyLayout" ? `${op.op} | ${note}` : undefined;
    currentScreen = op.screen;

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
        const units = inferEquipment(s.variables, s.tagImport?.structure) as unknown as LayoutUnit[];
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

        if (isComponentKind(op.type)) {
          const units = op.equipment ? inferEquipment(s.variables, s.tagImport?.structure) : [];
          const unit = units.find((u) => u.id.toLowerCase() === op.equipment!.toLowerCase());
          if (op.equipment && !unit) {
            reject(op, `No equipment called ${op.equipment}; there is ${units.map((u) => u.id).slice(0, 8).join(", ") || "none"}.`);
            break;
          }
          let use;
          try {
            use = componentUse({
              kind: op.type, variant: op.variant, size: op.size, tags: op.tags, tag: op.tag, equipment: unit,
              label: op.text ?? unit?.label,
              // A strip of tabs lists the screens; nothing else has to say so.
              props: op.type === "NavBar"
                ? { screens: s.screens.filter((x) => x.Type !== "Content").map((x) => ({ name: x.Name, title: x.Name.replace(/_/g, " ") })), current: screen.Name }
                : undefined,
            });
          } catch (error) {
            reject(op, error instanceof Error ? error.message : `${op.type} could not be drawn.`);
            break;
          }
          const missing = Object.values(use.tags).filter((tag) => !s.variables.some((v) => v.Name === tag));
          if (missing.length > 0) {
            reject(op, `${op.type} needs tags the project does not have: ${missing.join(", ")}`);
            break;
          }
          const wanted = sizeOfUse(use);
          const panel = panelOf(screen);
          if (wanted.width > panel.width || wanted.height > panel.height) {
            reject(op, `${op.type} size ${use.size} is ${wanted.width}x${wanted.height}, more than ${screen.Name} has; ask for a smaller size.`);
            break;
          }
          let at: Box;
          let where = "body";
          if (op.left !== undefined && op.top !== undefined) at = { ...wanted, left: op.left, top: op.top };
          else {
            const slot = slotFor(s, op, screen, wanted);
            if (!slot.ok) {
              reject(op, slot.reason);
              break;
            }
            at = slot.box;
            where = slot.region;
          }
          // Components draw on the grid, and a slot beside an engineer's part need not be on it.
          const unitPx = DEFAULT_THEME.grid.unit;
          const onGrid = (value: number, most: number) => Math.max(0, Math.min(Math.round(value / unitPx), Math.floor(most / unitPx))) * unitPx;
          const box = { ...wanted, left: onGrid(at.left, panel.width - wanted.width), top: onGrid(at.top, panel.height - wanted.height) };
          let cid: string;
          try {
            cid = s.addComponent(screen.UniqueId, use, box, name);
          } catch (error) {
            reject(op, error instanceof Error ? error.message : `${op.type} could not be drawn.`);
            break;
          }
          const afterC = store.getState();
          const instance = afterC.composites[cid];
          if (!instance) {
            reject(op, `${op.type} could not be placed on ${screen.Name}.`);
            break;
          }
          const frameId = instance.partIds[0];
          const h = handleOf(afterC, frameId);
          created.push({ asked: askedName, name: instance.name, type: op.type, id: frameId });
          out.created.push({ handle: h, name: instance.name, type: op.type, screen: handleOf(afterC, screen.UniqueId) });
          if (askedName && instance.name !== askedName) out.renamed.push({ asked: askedName, became: instance.name, handle: h });
          touch(afterC, frameId);
          ok(note || `Added ${op.type} ${h} ${instance.name} in the ${where} of ${screen.Name}`);
          break;
        }

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

        if (isCompositeKind(op.type)) {
          // A composite: its label is the text, its tag drives the value, the
          // rest comes from the definition's defaults.
          const cid = s.addComposite(
            screen.UniqueId,
            op.type,
            propsFor(op.type, {
              label: op.text ?? askedName ?? op.type,
              ...(op.tag ? (op.type === "EquipmentSymbol" ? { runTag: op.tag } : { tag: op.tag }) : {}),
            }),
            box,
            name,
          );
          const afterC = store.getState();
          const instance = afterC.composites[cid];
          if (!instance) {
            reject(op, `${op.type} could not be placed on ${screen.Name}.`);
            break;
          }
          const frameId = instance.partIds[0];
          const h = handleOf(afterC, frameId);
          created.push({ asked: askedName, name: instance.name, type: op.type, id: frameId });
          out.created.push({ handle: h, name: instance.name, type: op.type, screen: handleOf(afterC, screen.UniqueId) });
          if (askedName && instance.name !== askedName) out.renamed.push({ asked: askedName, became: instance.name, handle: h });
          touch(afterC, frameId);
          ok(note || `Added ${op.type} ${h} ${instance.name} in the ${region} of ${screen.Name}`);
          break;
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
        const size = sizeOf(found.part);
        let box: Box;
        if (op.dx !== undefined || op.dy !== undefined) {
          // "180 px to the right" is exactly that, even onto something else:
          // the engineer asked, and tidyLayout is there if it overlaps.
          box = clampToPanel(
            { ...size, left: found.part.Location.Left + (op.dx ?? 0), top: found.part.Location.Top + (op.dy ?? 0) },
            panelOf(found.screen),
          );
        } else if (op.left !== undefined || op.top !== undefined) {
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
        // A faceplate moves whole: the card takes everything drawn on it and a
        // composite moves with all its parts. Moving the card alone left the
        // lamps and readings behind on the old spot (lib/ote/tidy.ts).
        const members = moveSetOf(viewOf(found.screen).Children, found.part.UniqueId, (id) => s.objectMeta[id]?.groupId, panelOf(found.screen));
        if (members.length > 1) {
          s.nudge(members, box.left - found.part.Location.Left, box.top - found.part.Location.Top);
          for (const id of members) touch(s, id);
        } else {
          s.setBox(found.part.UniqueId, box);
          touch(s, found.part.UniqueId);
        }
        ok(note || `Moved ${handleOf(s, found.part.UniqueId)} ${found.part.Name}${members.length > 1 ? ` with its ${members.length - 1} parts` : ""}`);
        break;
      }

      case "resizeObject": {
        const found = resolve(s, op.target!);
        if (!found) {
          reject(op, unresolved(s, op.target!));
          break;
        }
        // A resize with no size did nothing and was reported as done - the
        // recorded session's "made the flow reading bold" was one of these.
        if (op.width === undefined && op.height === undefined) {
          reject(op, `resizeObject on ${found.part.Name} names no width or height; to restyle text use setText with bold or fontSize`);
          break;
        }
        s.setBox(
          found.part.UniqueId,
          clampToPanel(
            {
              left: found.part.Location.Left,
              top: found.part.Location.Top,
              width: op.width ?? (found.part.Width ?? 0),
              height: op.height ?? (found.part.Height ?? 0),
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
        const styling = op.bold !== undefined || op.fontSize !== undefined;
        const wording = op.text !== undefined || op.offText !== undefined || op.onText !== undefined;
        if (!styling && !wording) {
          reject(op, `setText on ${part.Name} carries no text, bold or fontSize`);
          break;
        }
        // Where the faces live: one Font on a display, one per state on a
        // lamp or a switch. Restyling touches every face; relabelling the
        // ones the op names.
        const faces: string[][] =
          part.Type === "Lamp" || part.Type === "ToggleSwitch" ? [["Off"], ["On"]]
          : part.Type === "Switch" ? [["Release"], ["Press"]]
          : part.Type === "N-StateLamp" ? part.States.map((_, i) => ["States", String(i)])
          : part.Type === "TextBox" || part.Type === "NumericDisplay" || part.Type === "StringDisplay" || part.Type === "DateTimeDisplay" ? [[]]
          : [];
        if (faces.length === 0) {
          reject(op, `${part.Name} is a ${part.Type} and carries no text.`);
          break;
        }
        if (wording) {
          if (part.Type === "TextBox") s.setProperty(part.UniqueId, ["Text"], op.text ?? "");
          else if (faces.length >= 2 && faces[0].length > 0) {
            const [off, on] = faces;
            if (op.offText !== undefined) s.setProperty(part.UniqueId, [...off, "Text"], op.offText);
            if (op.onText !== undefined) s.setProperty(part.UniqueId, [...on, "Text"], op.onText);
            // One wording for the part reads on every face: the off face is the one on the canvas.
            if (op.text !== undefined && op.offText === undefined && op.onText === undefined) {
              for (const face of faces) s.setProperty(part.UniqueId, [...face, "Text"], op.text);
            }
          } else {
            reject(op, `${part.Name} is a ${part.Type}; its text comes from the bound tag`);
            break;
          }
        }
        if (styling) {
          for (const face of faces) {
            const holder = face.reduce<Record<string, unknown>>(
              (n, k) => (n[k] ?? {}) as Record<string, unknown>,
              part as unknown as Record<string, unknown>,
            );
            const font: Record<string, unknown> = { ...((holder.Font as Record<string, unknown> | undefined) ?? FONT) };
            if (op.bold !== undefined) font.Bold = op.bold;
            if (op.fontSize !== undefined) font.Size = op.fontSize;
            s.setProperty(part.UniqueId, [...face, "Font"], font);
          }
        }
        touch(s, part.UniqueId);
        ok(note || (wording ? `Relabelled ${part.Name}` : `Restyled ${part.Name}`));
        break;
      }

      case "setColor": {
        const found = resolve(s, op.target!);
        // A token says what the colour means; the theme says which colour that is.
        const value = op.token ? DEFAULT_THEME.tokens[op.token] : op.color ? COLOR[op.color] : undefined;
        if (!found) {
          reject(op, unresolved(s, op.target!));
          break;
        }
        if (value === undefined) {
          reject(op, `${op.token ?? op.color ?? "That"} is not a colour in the palette.`);
          break;
        }
        const type = found.part.Type;
        if (type === "CompoundObject" || type === "AlarmSummary") {
          reject(op, `${found.part.Name} is a ${type === "CompoundObject" ? "Compound Object" : "alarm summary"}; its colours come from its definition, so setColor would not show.`);
          break;
        }
        // A text box draws only its words.
        if (type === "TextBox" && op.colorRole && op.colorRole !== "text") {
          reject(op, `${found.part.Name} is a text box and draws no ${op.colorRole}; put a rectangle behind it, or colour its text.`);
          break;
        }
        const role = op.colorRole ?? (type === "TextBox" ? "text" : "fill");
        const key = role === "border" ? "Border" : role === "text" ? "TextColor" : "Fill";
        // Parts with states draw a face, not the part. A lamp's colour says it is on,
        // so that is the face painted, and the report says which it was.
        const faces: { path: string[]; said: string }[] =
          type === "Lamp" || type === "ToggleSwitch" ? [{ path: ["On"], said: "on-state " }]
          : type === "Switch" ? [{ path: ["Release"], said: "" }, { path: ["Press"], said: "" }]
          : type === "N-StateLamp" ? found.part.States.map((_, i) => ({ path: ["States", String(i)], said: "" }))
          : [{ path: [], said: "" }];
        for (const face of faces) s.setProperty(found.part.UniqueId, [...face.path, key, "Color", "Value"], value);
        touch(s, found.part.UniqueId);
        ok(note || `Set ${found.part.Name} ${faces[0].said}${role} to ${op.token ?? op.color}`);
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

      case "applyPack": {
        const screen = op.screen ? findScreen(s, op.screen) : undefined;
        if (op.screen && !screen) {
          reject(op, `No screen called ${op.screen}`);
          break;
        }
        const changes = s.applyStandard(screen?.UniqueId);
        if (changes.length === 0) {
          ok(note || "Already on the Standard; nothing to change");
          break;
        }
        ok(note || `Applied the Standard: ${changes.length} changes (${changes.slice(0, 3).join("; ")}${changes.length > 3 ? "; …" : ""})`);
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

      case "tidyLayout": {
        // Overlaps are geometry: found and moved clear by the layout engine
        // (lib/ote/tidy.ts), a faceplate whole, never by guessed handles.
        const screen = findScreen(s, op.screen);
        if (!screen) {
          reject(op, `No screen called ${op.screen}`);
          break;
        }
        const scene = sceneOf({ screen, panel: panelOf(screen), meta: s.objectMeta, handles: s.handles, opened: true });
        const plan = solveLayout({ scene, parts: viewOf(screen).Children, groupOf: (id) => s.objectMeta[id]?.groupId,
          constraints: [{ id: "tidy", kind: "noOverlap", scope: "screen" }, { id: "tidy-snap", kind: "snap", scope: "screen" }] });
        const verified = verifyPlan({ scene, parts: viewOf(screen).Children, groupOf: (id) => s.objectMeta[id]?.groupId,
          constraints: [{ id: "tidy", kind: "noOverlap", scope: "screen" }, { id: "tidy-snap", kind: "snap", scope: "screen" }] }, plan);
        tidied.screens++;
        const moved: string[] = [];
        // The solver places the whole screen or nothing, so one overlap with no
        // room would stop the others. Then it falls to the part-by-part plan,
        // which clears what it can and names what it could not.
        if (!plan.conflict && verified.ok) {
          for (const move of plan.moves) {
            s.nudge(move.ids, move.to.left - move.from.left, move.to.top - move.from.top);
            for (const id of move.ids) touch(s, id);
            moved.push(viewOf(screen).Children.find((part) => part.UniqueId === move.ids[0])?.Name ?? move.unit);
          }
        }
        const live = store.getState().screens.find((x) => x.UniqueId === screen.UniqueId) ?? screen;
        const rest = planTidy(viewOf(live).Children, panelOf(live), (id) => s.objectMeta[id]?.groupId);
        for (const move of rest.moves) {
          s.nudge(move.ids, move.dx, move.dy);
          for (const id of move.ids) touch(s, id);
          moved.push(move.name);
        }
        if (moved.length > 0 || rest.stuck.length > 0) tidied.found++;
        if (moved.length > 0) {
          ok(`${note ? `${note}: ` : ""}${screen.Name}: moved ${moved.length} clear (${moved.slice(0, 4).join(", ")}${moved.length > 4 ? ", …" : ""})`);
        }
        if (rest.stuck.length > 0) {
          reject(op, `${screen.Name}: no clear spot for ${rest.stuck.join(", ")}; the screen is full - ask for a new screen or say what to remove`);
        }
        break;
      }

      case "alignObjects": {
        const ids = (op.targets ?? [])
          .map((name) => resolve(s, name)?.part.UniqueId)
          .filter((id): id is string => !!id);
        if (ids.length === 0) {
          const asked = (op.targets ?? []).join(", ") || "nothing";
          const near = nearest(s, op.targets?.[0] ?? "");
          reject(op, `None of ${asked} exist on any screen, so there was nothing to align${near.length ? `; objects nearby: ${near.join(", ")}` : ""}. To fix overlaps, use tidyLayout.`);
          break;
        }
        // Aligning what was found without the rest moved one button to the screen edge and said "done" (S3-03).
        const missing = (op.targets ?? []).filter((name) => !resolve(s, name));
        if (missing.length > 0) {
          reject(op, `Nothing was aligned: ${missing.map((name) => unresolved(s, name)).join("; ")}`);
          break;
        }
        // No mode said is not "left": six lamps on three faceplates, asked to
        // line up "to the top", were all stacked on one x because the model
        // left mode out and the default moved them sideways. The note usually
        // says which way; when it does not, ask rather than guess.
        const said = `${op.note ?? ""} ${op.text ?? ""}`.toLowerCase();
        const mode =
          op.mode ??
          (/\btop\b/.test(said) ? "top"
          : /\bbottom\b/.test(said) ? "bottom"
          : /\b(middle|vertical(ly)? cent(re|er))\b/.test(said) ? "middle"
          : /\bcent(re|er)\b/.test(said) ? "centre"
          : /\bright\b/.test(said) ? "right"
          : /\bleft\b/.test(said) ? "left"
          : /\bspread|distribut/.test(said) ? (/\bvertical/.test(said) ? "spreadVertical" : "spreadHorizontal")
          : undefined);
        if (!mode) {
          reject(op, "Say which way to align: left, centre, right, top, middle or bottom, or spread.");
          break;
        }
        if (mode.startsWith("spread") && ids.length < 3) {
          // Two objects are already evenly spread: nothing would move.
          reject(op, `Spreading needs at least three objects; ${ids.length} given. To move one, use moveObject.`);
          break;
        }
        const targetScreen = findPartById(s, ids[0])?.screen;
        if (!targetScreen || ids.some((id) => findPartById(s, id)?.screen.UniqueId !== targetScreen.UniqueId)) {
          reject(op, "Alignment needs objects on one screen.");
          break;
        }
        const scene = sceneOf({ screen: targetScreen, panel: panelOf(targetScreen), meta: s.objectMeta, handles: s.handles, opened: true });
        const constraint: Constraint = mode === "spreadHorizontal" ? { id: "align", kind: "distribute", units: ids, axis: "x" }
          : mode === "spreadVertical" ? { id: "align", kind: "distribute", units: ids, axis: "y" }
          : { id: "align", kind: "align", units: ids, edge: mode as "left" };
        const input = { scene, parts: viewOf(targetScreen).Children,
          constraints: [constraint], groupOf: (id: string) => s.objectMeta[id]?.groupId };
        const plan = solveLayout(input);
        const verification = verifyPlan(input, plan);
        if (plan.conflict || !verification.ok) {
          reject(op, plan.conflict?.reason ?? `Alignment was not applied: ${verification.checks.filter((check) => !check.ok).map((check) => check.name).join(", ")}`);
          break;
        }
        for (const move of plan.moves) {
          s.nudge(move.ids, move.to.left - move.from.left, move.to.top - move.from.top);
          if (move.ids.length === 1 && (move.to.width !== move.from.width || move.to.height !== move.from.height)) s.setBox(move.ids[0], move.to);
        }
        for (const id of ids) touch(s, id);
        ok(note || `Aligned ${ids.length} objects`);
        break;
      }

      case "arrange": {
        const screen = findScreen(s, op.screen);
        if (!screen) { reject(op, `No screen called ${op.screen}`); break; }
        if ([op.left, op.top, op.dx, op.dy, op.width, op.height].some((value) => value !== undefined)) {
          reject(op, "Arrange accepts constraints, not coordinates.");
          break;
        }
        const constraints = op.constraints ?? [];
        if (!constraints.length) { reject(op, "Arrange needs one or more layout constraints."); break; }
        const scene = sceneOf({ screen, panel: panelOf(screen), meta: s.objectMeta, handles: s.handles, opened: true });
        const input = { scene, parts: viewOf(screen).Children, constraints, groupOf: (id: string) => s.objectMeta[id]?.groupId };
        const plan = solveLayout(input);
        const verified = verifyPlan(input, plan);
        if (plan.conflict || !verified.ok) {
          reject(op, plan.conflict?.reason ?? `Arrangement was not applied: ${verified.checks.filter((check) => !check.ok).map((check) => check.name).join(", ")}`);
          break;
        }
        for (const move of plan.moves) {
          s.nudge(move.ids, move.to.left - move.from.left, move.to.top - move.from.top);
          if (move.ids.length === 1 && (move.to.width !== move.from.width || move.to.height !== move.from.height)) s.setBox(move.ids[0], move.to);
          for (const id of move.ids) touch(s, id);
        }
        ok(note || `${screen.Name}: arranged ${plan.moves.length} unit${plan.moves.length === 1 ? "" : "s"}`);
        break;
      }

      case "matchSize": {
        const found = (op.targets ?? []).map((name) => resolve(s, name));
        const missing = (op.targets ?? []).filter((_, i) => !found[i]);
        if (missing.length > 0) {
          reject(op, `Nothing was resized: ${missing.map((name) => unresolved(s, name)).join("; ")}`);
          break;
        }
        if (found.length < 2) {
          reject(op, `matchSize needs at least two objects, the first being the size to copy; ${found.length} given.`);
          break;
        }
        const sizes = matchSizes(found.map((f) => f!.part), op.dimension ?? "both");
        for (const f of found.slice(1)) {
          const size = sizes.get(f!.part.UniqueId)!;
          s.setBox(f!.part.UniqueId, clampToPanel({ left: f!.part.Location.Left, top: f!.part.Location.Top, ...size }, panelOf(f!.screen)));
          touch(s, f!.part.UniqueId);
        }
        ok(note || `Matched ${found.length - 1} objects to the size of ${found[0]!.part.Name}`);
        break;
      }

      case "snapToGrid": {
        const found = (op.targets ?? []).map((name) => resolve(s, name));
        const missing = (op.targets ?? []).filter((_, i) => !found[i]);
        if (missing.length > 0) {
          reject(op, `Nothing was snapped: ${missing.map((name) => unresolved(s, name)).join("; ")}`);
          break;
        }
        const screen = found[0]?.screen ?? findScreen(s, op.screen);
        if (!screen) {
          reject(op, `No screen called ${op.screen}`);
          break;
        }
        const groupOf = (id: string) => s.objectMeta[id]?.groupId;
        const parts = viewOf(screen).Children;
        const panel = panelOf(screen);
        // The grid this screen is on, unless one was asked for.
        const onScreen = sceneOf({ screen, panel, meta: s.objectMeta, handles: s.handles, opened: true }).grid.unit;
        // A unit of 1 is what a screen with no grid reads as; snapping to it does nothing.
        const grid = op.grid ?? (onScreen === 1 ? 4 : onScreen);
        if (!(grid >= 1)) {
          reject(op, `A grid of ${grid} pixels cannot be snapped to.`);
          break;
        }
        // Each faceplate snaps as one, so its lamps keep their place on the card.
        const asked = found.length > 0
          ? found.map((f) => moveSetOf(parts, f!.part.UniqueId, groupOf, panel))
          : unitsOf(parts, groupOf, panel).map((u) => u.ids);
        const seen = new Set<string>();
        let snapped = 0;
        for (const ids of asked) {
          if (ids.some((id) => seen.has(id))) continue;
          for (const id of ids) seen.add(id);
          const members = parts.filter((p) => ids.includes(p.UniqueId));
          if (members.length === 0) continue;
          const left = Math.min(...members.map((p) => p.Location.Left));
          const top = Math.min(...members.map((p) => p.Location.Top));
          const right = Math.max(...members.map((p) => p.Location.Left + (p.Width ?? 0)));
          const bottom = Math.max(...members.map((p) => p.Location.Top + (p.Height ?? 0)));
          const to = snapPosition({ left, top, width: right - left, height: bottom - top }, grid, panel);
          if (to.left === left && to.top === top) continue;
          s.nudge(ids, to.left - left, to.top - top);
          for (const id of ids) touch(s, id);
          snapped++;
        }
        if (snapped > 0) ok(note || `Snapped ${snapped} objects to the ${grid} px grid on ${screen.Name}`);
        else ok(`Everything asked for was already on the ${grid} px grid on ${screen.Name}`);
        break;
      }

      case "bindTag": {
        const found = resolve(s, op.target!);
        const tag = tagOf(s.variables, op, [op.name, op.message, op.note]);
        if (!found) {
          reject(op, unresolved(s, op.target!));
          break;
        }
        if (!tag) {
          reject(op, noTag(op, "nothing was bound"));
          break;
        }
        const property = op.property ?? valuePropertyOf(found.part) ?? "CurrentValue";
        // OTE refuses to simulate a StringDisplay whose value is not a STRING tag (benched, S1-17).
        // The other pairs it refuses are not known, so this is the only one turned away here.
        if (found.part.Type === "StringDisplay" && property === "CurrentValue" && tag.DataType !== "STRING") {
          reject(op, `${found.part.Name} is a StringDisplay and shows only a STRING tag; ${tag.Name} is ${tag.DataType}, and OTE will not simulate that. Use a NumericDisplay or a Lamp for it`);
          break;
        }
        // A bar binds its fill, not CurrentValue; and a rebind replaces the old tag rather than adding a second.
        s.setBinding(found.part.UniqueId, property, tag.Name);
        touch(s, found.part.UniqueId);
        ok(note || `Bound ${tag.Name} to ${handleOf(s, found.part.UniqueId)} ${found.part.Name}`);
        break;
      }

      case "addAlarm": {
        const tag = tagOf(s.variables, op, [op.target, op.name, op.message, op.note]);
        if (!tag) {
          reject(op, noTag(op, "no alarm was added"));
          break;
        }
        const level = [1, 2, 3, 4].includes(op.alarmType ?? 0) ? op.alarmType! : 2;
        const kind = op.alarmKind === 1 || tag.DataType === "BOOL" ? 1 : 2;
        const draft = { Trigger: tag.Name, AlarmType: level as 1 | 2 | 3 | 4, AlarmRecordType: kind as 1 | 2 } as Alarm;
        const existing = s.alarms.find((a) => sameCondition(a, draft));
        // Words an operator reads, from the tag's own comment: "Milk fridge
        // temperature high", never "TT_401_PV alarm".
        const said = tag.Comments?.trim() || tag.Name;
        const word = kind === 1 ? "" : ` ${({ 1: "high high", 2: "high", 3: "low", 4: "low low" } as const)[level as 1 | 2 | 3 | 4]}`;
        const alarm: Alarm = {
          ...draft,
          Message: op.message?.trim() || existing?.Message || `${said}${word}`,
          Severity: Math.min(9, Math.max(1, Math.round(op.severity ?? existing?.Severity ?? 5))),
          Value: kind === 2 ? (op.value ?? existing?.Value ?? "0") : "",
        };
        s.addAlarm(alarm);
        ok(note || `${existing ? "Updated" : "Added"} alarm "${alarm.Message}" on ${tag.Name}`);
        break;
      }
    }
  }

  if (tidied.screens > 0 && tidied.found === 0) {
    ok(tidied.screens === 1 ? "Nothing overlaps on this screen" : `Nothing overlaps on any of the ${tidied.screens} screens`);
  }
  for (const { at, count } of firstRefusal.values()) {
    if (count < 2) continue;
    const first = out.rejected[at];
    const i = out.problems.indexOf(first.reason);
    first.reason = `${first.reason} - and the same on ${count - 1} more`;
    if (i >= 0) out.problems[i] = first.reason;
  }
  for (const { at, line, count } of firstLine.values()) {
    if (count < 2) continue;
    const i = out.changes.indexOf(line);
    out.applied[at] = `${line} — ${count} objects`;
    if (i >= 0) out.changes[i] = out.applied[at];
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
  /** The project state the run was drawn on, and its ops, so `commit` can tell the project has moved. */
  base: State;
  ops: Op[];
}

/**
 * Runs the ops on a copy. The live project does not change; the caller
 * decides whether to commit, ask the model to repair, or show a proposal.
 */
export function dryRun(ops: Op[], live: ProjectStore = useProject): DryRun {
  const scratch = createProjectStore();
  const base = live.getState();
  scratch.setState(seedFrom(base));
  const outcome = applyOps(ops, scratch);
  const s = scratch.getState();
  return {
    outcome,
    scratch,
    base,
    ops,
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

/**
 * Lands a dry run on the live project as one undo step, and answers the run
 * that landed. The patch is the whole slice, so if the project moved since the
 * run was drawn (an edit while a proposal waited) the ops run again on it
 * first; landing the old patch would revert that edit (docs/audit/BUGS.md S1-06).
 */
export function commit(run: DryRun, label: string, live: ProjectStore = useProject): DryRun {
  const now = live.getState();
  const moved = (["screens", "bindings", "alarms", "objectMeta", "screenPlacement", "handles", "handleSeq"] as const).some((k) => now[k] !== run.base[k]);
  const landed = moved ? dryRun(run.ops, live) : run;
  now.commitBatch(label, landed.patch);
  return landed;
}

/**
 * What the dry run would change, per screen, for the canvas to ghost: parts
 * that would appear, parts that would go, parts whose box would change.
 * Screens the run would create appear with everything on them as added.
 */
export function previewOf(run: DryRun, live: ProjectStore = useProject): Record<string, ScreenPreview> {
  const before = new Map(live.getState().screens.map((s) => [s.UniqueId, s]));
  const out: Record<string, ScreenPreview> = {};
  const box = (p: Part) => ({ left: p.Location.Left, top: p.Location.Top, ...sizeOf(p) });

  for (const screen of run.patch.screens) {
    const was = before.get(screen.UniqueId);
    const preview: ScreenPreview = { added: [], removed: [], moved: [] };
    const after = new Map(screen.Children[0].Children.map((p) => [p.UniqueId, p]));
    const earlier = new Map(was?.Children[0].Children.map((p) => [p.UniqueId, p]) ?? []);
    for (const [id, part] of after) {
      const old = earlier.get(id);
      if (!old) preview.added.push(part);
      else {
        const a = box(old);
        const b = box(part);
        if (a.left !== b.left || a.top !== b.top || a.width !== b.width || a.height !== b.height) {
          preview.moved.push({ id, from: a, to: b });
        }
      }
    }
    for (const id of earlier.keys()) if (!after.has(id)) preview.removed.push(id);
    if (preview.added.length || preview.removed.length || preview.moved.length) out[screen.UniqueId] = preview;
  }
  // A screen the run would delete: everything on it is "removed".
  for (const [id, screen] of before) {
    if (!run.patch.screens.some((s) => s.UniqueId === id)) {
      out[id] = { added: [], removed: screen.Children[0].Children.map((p) => p.UniqueId), moved: [] };
    }
  }
  return out;
}
