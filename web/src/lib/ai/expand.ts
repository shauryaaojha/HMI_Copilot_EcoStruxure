/**
 * One op, many objects: the scope of a change, resolved before it is applied.
 *
 * The model sees the active screen's objects and the list of screens, nothing
 * more. An engineer asks for changes that reach further than that - "make the
 * background dark grey on every screen", "bigger lamps on the Boilers screen",
 * "drop the footer from s3 and s5", "PMP_101 amber wherever it appears". The
 * model used to answer those by changing the one object it could see, or by
 * inventing handles (o1197_bg) for the ones it could not.
 *
 * Every op may now say where and what:
 *
 *   screens     ["all"], or screen handles and names ("s3", "Boilers"). Absent
 *               means the op's own screen, as before.
 *   select      instead of a handle, what to act on: a role every generated
 *               screen has (background, header, title, navigation, footer,
 *               alarms) or a part type (Lamp, NumericDisplay, TextBox, ...).
 *   selectText  narrows a select to objects whose name, text or bound tag
 *               contains it ("PMP_101", "Pressure").
 *
 * expandOps turns that into plain ops, one per object on each screen, each
 * naming its object by handle - so the applier's cases run unchanged, and a
 * change to twelve screens is twelve applied ops the engineer can read.
 *
 * An object named by handle with screens given is found again on each screen:
 * by its name stem (generated chrome is named after its screen, Ground_<name>),
 * then by the same type at the same position, to the pixel tolerance below.
 */

import type { Part, Screen } from "@/lib/ote/schema";
import type { Op } from "./ops";

/** The roles a select can name, and how each is recognised on a screen. */
export const SELECT_ROLES = ["background", "header", "title", "navigation", "footer", "alarms"] as const;
export type SelectRole = (typeof SELECT_ROLES)[number];

/** Generated chrome: the role, and the name stem the layout gives it. */
const ROLE_STEM: Record<SelectRole, string> = {
  background: "Ground",
  header: "Hdr",
  title: "HdrTitle",
  navigation: "Nav",
  footer: "Foot",
  alarms: "AlarmBanner",
};

/** Ops that act on an existing object and so can be fanned out over objects. */
const ON_OBJECTS = new Set<Op["op"]>(["moveObject", "resizeObject", "setText", "setColor", "deleteObject", "duplicateObject"]);
/** Ops on a set of objects: one op per screen, holding that screen's matches. */
const ON_SETS = new Set<Op["op"]>(["alignObjects", "groupObjects", "ungroupObjects"]);
/** Ops that create something on a screen and so can be repeated per screen. */
const ON_SCREENS = new Set<Op["op"]>(["addObject", "addEquipment"]);

/** Far more than any real request; a runaway select stops here, said aloud. */
export const MAX_EXPANDED = 600;
/** How far apart two objects may sit and still be "the same one" on two screens. */
const PIXELS = 4;

export interface ExpandState {
  screens: Screen[];
  activeScreenId?: string | null;
  handles: Record<string, string>;
  bindings: { tag: string; targetId: string }[];
}

export interface Expansion {
  ops: Op[];
  /** One line per op that was fanned out, for the turn's record. */
  notes: string[];
  /** Ops whose scope could not be resolved, with why. */
  rejected: { op: Op; reason: string }[];
}

const viewOf = (screen: Screen) => screen.Children[0];
const norm = (text: string) => text.toLowerCase().replace(/[\s_-]+/g, "");

/** The screens an op names: all of them, or each by handle, name or a near spelling. */
export function screensFor(state: ExpandState, refs: string[]): { screens: Screen[]; missing: string[] } {
  if (refs.some((r) => r.trim().toLowerCase() === "all")) return { screens: [...state.screens], missing: [] };
  const screens: Screen[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const wanted = ref.trim().toLowerCase();
    const byHandle = Object.entries(state.handles).find(([, h]) => h.toLowerCase() === wanted)?.[0];
    const found =
      state.screens.find((s) => s.UniqueId === byHandle) ??
      state.screens.find((s) => s.Name.toLowerCase() === wanted) ??
      state.screens.find((s) => norm(s.Name) === norm(ref)) ??
      // "the boilers screen" for BoilersAndWaterSupply, when only one matches.
      (() => {
        const near = state.screens.filter((s) => norm(s.Name).includes(norm(ref)) || norm(ref).includes(norm(s.Name)));
        return near.length === 1 ? near[0] : undefined;
      })();
    if (found && !screens.includes(found)) screens.push(found);
    else if (!found) missing.push(ref);
  }
  return { screens, missing };
}

const textOf = (part: Part): string => {
  const text = (part as { Text?: unknown }).Text;
  if (typeof text === "string") return text;
  if (text && typeof text === "object" && typeof (text as { Text?: unknown }).Text === "string") return (text as { Text: string }).Text;
  return "";
};

/** The objects on one screen a select names. */
export function selectOn(state: ExpandState, screen: Screen, select: string, selectText?: string): Part[] {
  const parts = viewOf(screen).Children;
  const role = SELECT_ROLES.find((r) => r === select.trim().toLowerCase());
  let found: Part[];
  if (role) {
    const named = parts.find((p) => p.Name === `${ROLE_STEM[role]}_${screen.Name}`);
    found = named ? [named] : roleByGeometry(screen, role);
  } else {
    const type = select.trim().toLowerCase();
    found = parts.filter((p) => p.Type.toLowerCase() === type);
  }
  if (!selectText?.trim()) return found;
  const wanted = selectText.trim().toLowerCase();
  const tagsOf = (id: string) => state.bindings.filter((b) => b.targetId === id).map((b) => b.tag.toLowerCase());
  return found.filter(
    (p) => p.Name.toLowerCase().includes(wanted) || textOf(p).toLowerCase().includes(wanted) || tagsOf(p.UniqueId).some((t) => t.includes(wanted)),
  );
}

/**
 * A role on a screen the generator did not draw (an imported project): the
 * rectangle that covers the panel is its background, a full-width band at the
 * top its header, one at the bottom its footer.
 */
function roleByGeometry(screen: Screen, role: SelectRole): Part[] {
  const view = viewOf(screen) as unknown as { Width?: number; Height?: number };
  const parts = viewOf(screen).Children.filter((p) => p.Type === "Rectangle");
  const width = view.Width ?? Math.max(0, ...parts.map((p) => p.Location.Left + (p.Width ?? 0)));
  const height = view.Height ?? Math.max(0, ...parts.map((p) => p.Location.Top + (p.Height ?? 0)));
  const full = (p: Part) => (p.Width ?? 0) >= width - PIXELS && p.Location.Left <= PIXELS;
  if (role === "background") {
    const cover = parts.find((p) => full(p) && p.Location.Top <= PIXELS && (p.Height ?? 0) >= height - PIXELS);
    return cover ? [cover] : [];
  }
  if (role === "header") {
    const band = parts.find((p) => full(p) && p.Location.Top <= PIXELS && (p.Height ?? 0) < height / 4);
    return band ? [band] : [];
  }
  if (role === "footer") {
    const band = parts.find((p) => full(p) && p.Location.Top + (p.Height ?? 0) >= height - PIXELS && (p.Height ?? 0) < height / 4);
    return band ? [band] : [];
  }
  if (role === "alarms") return viewOf(screen).Children.filter((p) => p.Type === "AlarmSummary");
  return [];
}

/** Where an object is, by handle or by exact name. */
function locate(state: ExpandState, ref: string): { part: Part; screen: Screen } | undefined {
  const wanted = ref.trim().toLowerCase();
  const id = Object.entries(state.handles).find(([, h]) => h.toLowerCase() === wanted)?.[0];
  for (const screen of state.screens) {
    const part = viewOf(screen).Children.find((p) => p.UniqueId === id || p.Name.toLowerCase() === wanted);
    if (part) return { part, screen };
  }
  return undefined;
}

/**
 * The same object on another screen: the name stem first (Ground_Boilers on
 * Boilers is Ground_MilkAndPowder on MilkAndPowder), then the same type at the
 * same position and size, within a few pixels.
 */
export function counterpartOn(found: { part: Part; screen: Screen }, screen: Screen): Part | undefined {
  if (screen === found.screen) return found.part;
  const parts = viewOf(screen).Children;
  const suffix = `_${found.screen.Name}`;
  if (found.part.Name.endsWith(suffix)) {
    const stem = found.part.Name.slice(0, -suffix.length);
    const named = parts.find((p) => p.Name === `${stem}_${screen.Name}`);
    if (named) return named;
  }
  const a = found.part;
  return parts.find(
    (p) =>
      p.Type === a.Type &&
      Math.abs(p.Location.Left - a.Location.Left) <= PIXELS &&
      Math.abs(p.Location.Top - a.Location.Top) <= PIXELS &&
      Math.abs((p.Width ?? 0) - (a.Width ?? 0)) <= PIXELS &&
      Math.abs((p.Height ?? 0) - (a.Height ?? 0)) <= PIXELS,
  );
}

const handleOrName = (state: ExpandState, part: Part) => state.handles[part.UniqueId] ?? part.Name;
const screenRef = (state: ExpandState, screen: Screen) => state.handles[screen.UniqueId] ?? screen.Name;

/** Every op with a scope, as the plain ops it stands for. */
export function expandOps(ops: Op[], state: ExpandState): Expansion {
  const out: Op[] = [];
  const notes: string[] = [];
  const rejected: Expansion["rejected"] = [];
  const active = state.screens.find((s) => s.UniqueId === state.activeScreenId) ?? state.screens[0];

  for (const op of ops) {
    const scoped = (op.screens?.length ?? 0) > 0 || !!op.select;
    if (!scoped) {
      out.push(op);
      continue;
    }
    const { screens: _screens, select, selectText, ...plain } = op;

    let screens: Screen[];
    if (op.screens?.length) {
      const resolved = screensFor(state, op.screens);
      if (resolved.missing.length > 0) {
        rejected.push({ op, reason: `No screen called ${resolved.missing.join(", ")}; the screens are ${state.screens.map((s) => `${screenRef(state, s)} ${s.Name}`).join(", ")}` });
        if (resolved.screens.length === 0) continue;
      }
      screens = resolved.screens;
    } else {
      const own = op.screen ? screensFor(state, [op.screen]).screens[0] : undefined;
      screens = own ? [own] : active ? [active] : [];
    }

    if (ON_SCREENS.has(op.op)) {
      for (const screen of screens) {
        const name = op.name && screens.length > 1 ? `${op.name}_${screen.Name}` : op.name;
        out.push({ ...plain, screen: screenRef(state, screen), ...(name ? { name } : {}) });
      }
      notes.push(`${op.op} on ${screens.length} screen${screens.length === 1 ? "" : "s"}`);
      continue;
    }

    if (ON_SETS.has(op.op)) {
      // "Align the lamps", "group the boiler readings": the set on each screen.
      const anchors = (op.targets ?? []).map((t) => locate(state, t)).filter((f): f is NonNullable<typeof f> => !!f);
      let reached = 0;
      for (const screen of screens) {
        const parts = select
          ? selectOn(state, screen, select, selectText)
          : anchors.map((a) => counterpartOn(a, screen)).filter((p): p is Part => !!p);
        if (parts.length === 0) continue;
        out.push({ ...plain, targets: parts.map((p) => handleOrName(state, p)), screen: screenRef(state, screen) });
        reached++;
      }
      if (reached === 0) {
        const what = select ? `${select}${selectText ? ` matching "${selectText}"` : ""}` : (op.targets ?? []).join(", ");
        rejected.push({ op, reason: `Nothing to ${op.op}: no ${what} on ${screens.map((sc) => sc.Name).join(", ")}` });
      } else notes.push(`${op.op} on ${reached} screen${reached === 1 ? "" : "s"}`);
      continue;
    }

    if (!ON_OBJECTS.has(op.op)) {
      // Screen-level and project-level ops carry no object to fan out.
      for (const screen of screens) out.push({ ...plain, screen: screenRef(state, screen) });
      continue;
    }

    const anchor = !select && op.target ? locate(state, op.target) : undefined;
    if (!select && !anchor) {
      // Something created earlier in this batch, named by the model: leave it
      // to the applier, which knows the batch.
      out.push(plain);
      continue;
    }

    // "the PMP_101 lamps" with no screen named: the active screen first, and
    // if nothing there matches, wherever they are.
    if (select && selectText && !op.screens?.length && !op.screen && screens.every((sc) => selectOn(state, sc, select, selectText).length === 0)) {
      screens = state.screens.filter((sc) => selectOn(state, sc, select, selectText).length > 0);
    }
    let count = 0;
    const missingOn: string[] = [];
    for (const screen of screens) {
      const parts = select ? selectOn(state, screen, select, selectText) : [counterpartOn(anchor!, screen)].filter((p): p is Part => !!p);
      if (parts.length === 0) missingOn.push(screen.Name);
      for (const part of parts) {
        if (out.length >= MAX_EXPANDED) break;
        out.push({ ...plain, target: handleOrName(state, part), screen: screenRef(state, screen) });
        count++;
      }
    }
    if (count === 0) {
      const what = select ? `${select}${selectText ? ` matching "${selectText}"` : ""}` : op.target;
      rejected.push({ op, reason: `Nothing to ${op.op}: no ${what} on ${missingOn.join(", ")}` });
      continue;
    }
    notes.push(
      `${op.op} on ${count} object${count === 1 ? "" : "s"} across ${screens.length - missingOn.length} screen${screens.length - missingOn.length === 1 ? "" : "s"}` +
        (missingOn.length ? ` (none on ${missingOn.join(", ")})` : ""),
    );
    if (out.length >= MAX_EXPANDED) {
      rejected.push({ op, reason: `Stopped at ${MAX_EXPANDED} changes in one turn; narrow the request.` });
      break;
    }
  }
  return { ops: out, notes, rejected };
}
