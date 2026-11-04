/**
 * S5 (audit 2026-11): the geometry evidence for docs/audit/DESIGN_NESTED_CANVAS.md.
 *
 * For every project given on the command line (the engineer files are
 * gitignored client data, so they are passed in, never committed), the tracked
 * fixtures, and layouts the app generates itself, it measures per screen:
 * overlaps (lib/ote/tidy.ts), the geometry critic's overlap and alignment
 * findings, what planTidy moves and what it leaves, parts off the 8px grid,
 * parts outside the panel, container nesting, and the TextLayout enum values
 * in the raw files. Output is numbers only, keyed by file name and screen
 * INDEX, never a screen name, tag or text (RULES.md, client data).
 *
 *   cd web && MONGODB_URI= npx tsx scripts/audit/s5-measure.mts <out.json> <engineer.eote>... --ours <tracked.eote>...
 */
import fs from "node:fs";
import path from "node:path";
import { readProject } from "@/lib/ote/reader";
import { overlapsOn, planTidy } from "@/lib/ote/tidy";
import { critiqueGeometry } from "@/lib/critic/geometry";
import { rootBox, type Part, type Screen, type Variable } from "@/lib/ote/schema";
import { layoutApplication } from "@/lib/ote/layout";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { demoScreen } from "@/fixtures";
import { isContainer } from "@/lib/ote/containers";

type Raw = Record<string, unknown>;
const GRID = 8;

interface ScreenStats {
  file: string;
  screen: number;
  root: string;
  panel: string;
  parts: number;
  carried: number;
  containerDepth: number;
  leavesBySlot: Record<string, number>;
  overlapsBefore: number;
  overlapsAfter: number;
  tidyMoves: number;
  tidyStuck: number;
  criticOverlapBefore: number;
  criticOverlapAfter: number;
  criticAlignBefore: number;
  criticAlignAfter: number;
  offGrid: number;
  offGridAfterTidy: number;
  outOfPanel: number;
  paths: number;
  libraryDropOffPanel: boolean;
  frameDiffersFromFirst: boolean;
  nearMiss: number;
  /** Parts whose Left and Top are both multiples of g, for g in GRIDS. */
  onGrid: Record<string, number>;
  fractional: number;
  outNames: string[];
  perturb: ReturnType<typeof perturb>;
}

const cloneMoved = (parts: Part[], moves: { ids: string[]; dx: number; dy: number }[]) => {
  const out = parts.map((p) => structuredClone(p));
  for (const m of moves) for (const p of out) if (m.ids.includes(p.UniqueId)) { p.Location.Left += m.dx; p.Location.Top += m.dy; }
  return out;
};
const count = (screen: Screen, rule: string) => critiqueGeometry(screen).findings.filter((f) => f.rule === rule).length;
const withParts = (screen: Screen, parts: Part[]): Screen => ({ ...screen, Children: [{ ...screen.Children[0], Children: parts }] } as Screen);
const off = (p: Part) => p.Location.Left % GRID !== 0 || p.Location.Top % GRID !== 0;

function depthOf(node: Raw, d = 0): number {
  const kids = Array.isArray(node.Children) ? (node.Children as Raw[]) : [];
  let best = d;
  for (const k of kids) if (isContainer(k)) best = Math.max(best, depthOf(k, d + 1));
  return best;
}

function tallyText(node: unknown, h: Record<string, number>, v: Record<string, number>) {
  if (Array.isArray(node)) return node.forEach((x) => tallyText(x, h, v));
  if (!node || typeof node !== "object") return;
  const o = node as Raw;
  const t = o.TextLayout as Raw | undefined;
  if (t && typeof t === "object") {
    if (t.HorizontalAlignment !== undefined) h[String(t.HorizontalAlignment)] = (h[String(t.HorizontalAlignment)] ?? 0) + 1;
    if (t.VerticalAlignment !== undefined) v[String(t.VerticalAlignment)] = (v[String(t.VerticalAlignment)] ?? 0) + 1;
  }
  for (const val of Object.values(o)) if (val && typeof val === "object") tallyText(val, h, v);
}

const CHROME = /^(Ground|Hdr|HdrTitle|HdrLevel|Nav|NavChip|NavLbl|NavGo|Foot|FootLbl|FootMark|AlarmBanner|AlarmsLbl)_/;
const edges = (p: Part) => {
  const l = p.Location.Left, t = p.Location.Top, w = p.Width ?? 0, h = p.Height ?? 0;
  return { x: [l, l + w / 2, l + w], y: [t, t + h / 2, t + h] };
};
/** Pairs of parts with an edge or centre 1-3 px from one of the other's: a line-up that missed. */
function nearMisses(parts: Part[]): number {
  const ps = parts.filter((p) => !CHROME.test(p.Name));
  let n = 0;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = edges(ps[i]), b = edges(ps[j]);
    const miss = (u: number[], v: number[]) => u.some((x, k) => { const d = Math.abs(x - v[k]); return d > 0.01 && d <= 3; });
    if (miss(a.x, b.x) || miss(a.y, b.y)) n++;
  }
  return n;
}
/** Does this part share an exact left, centre or right (and top, middle or bottom) with any other? */
function linedUp(part: Part, others: Part[]): { x: boolean; y: boolean } {
  const a = edges(part);
  const others2 = others.filter((o) => o.UniqueId !== part.UniqueId && !CHROME.test(o.Name));
  return {
    x: others2.some((o) => edges(o).x.some((v) => a.x.some((u) => Math.abs(u - v) < 0.01))),
    y: others2.some((o) => edges(o).y.some((v) => a.y.some((u) => Math.abs(u - v) < 0.01))),
  };
}

/**
 * The edit the chat makes: one object pushed onto its neighbour. Up to five per
 * screen, deterministic. Then tidyLayout's planner, and what it left.
 */
function perturb(parts: Part[], panel: { width: number; height: number }) {
  const big = (panel.width * panel.height) / 2;
  const movable = parts.filter((p) => !CHROME.test(p.Name) && p.Type !== "Pipe" && (p.Width ?? 0) * (p.Height ?? 0) < big && (p.Width ?? 0) > 0 && (p.Height ?? 0) > 0);
  const out = { trials: 0, overlapsLeft: 0, stuck: 0, nearMissAdded: 0, endedOffGrid: 0, endedUnalignedX: 0, endedUnalignedY: 0, wasAlignedX: 0, wasAlignedY: 0, meanDisplacement: 0 };
  const base = nearMisses(parts);
  let disp = 0;
  for (let k = 0; k < Math.min(5, movable.length - 1); k++) {
    const a = movable[k], b = movable[k + 1];
    const was = linedUp(a, parts);
    const dx = Math.round(b.Location.Left + (b.Width ?? 0) / 3 - a.Location.Left);
    const dy = Math.round(b.Location.Top + (b.Height ?? 0) / 3 - a.Location.Top);
    const pushed = parts.map((p) => (p.UniqueId === a.UniqueId ? { ...structuredClone(p), Location: { Left: p.Location.Left + dx, Top: p.Location.Top + dy } } : p));
    if (overlapsOn(pushed, undefined, panel).length === 0) continue;
    out.trials++;
    const plan = planTidy(pushed, panel);
    const after = cloneMoved(pushed, plan.moves);
    out.overlapsLeft += overlapsOn(after, undefined, panel).length > 0 ? 1 : 0;
    out.stuck += plan.stuck.length > 0 ? 1 : 0;
    out.nearMissAdded += Math.max(0, nearMisses(after) - base);
    const moved = after.filter((p) => plan.moves.some((m) => m.ids.includes(p.UniqueId)));
    for (const m of moved) if (off(m)) { out.endedOffGrid++; break; }
    const now = after.find((p) => p.UniqueId === a.UniqueId)!;
    const lu = linedUp(now, after);
    if (was.x) out.wasAlignedX++;
    if (was.y) out.wasAlignedY++;
    if (!lu.x) out.endedUnalignedX++;
    if (!lu.y) out.endedUnalignedY++;
    disp += Math.abs(now.Location.Left - a.Location.Left) + Math.abs(now.Location.Top - a.Location.Top);
  }
  out.meanDisplacement = out.trials ? Math.round(disp / out.trials) : 0;
  return out;
}

function measure(file: string, index: number, screen: Screen, panelFallback: { width: number; height: number }, first: { width: number; height: number }, extra: Partial<ScreenStats> = {}): ScreenStats {
  const view = screen.Children[0];
  const panel = rootBox(view, panelFallback);
  const parts = view.Children;
  const plan = planTidy(parts, panel);
  const after = cloneMoved(parts, plan.moves);
  const moved = new Set(plan.moves.flatMap((m) => m.ids));
  const size = Math.min(160, rootBox(view).width / 6);
  const paths = parts.filter((p) => p.Type === "Path").length;
  const dropTop = 96 + Math.floor(paths / 4) * (size + 20);
  return {
    file,
    screen: index,
    root: String(view.Type),
    panel: `${panel.width}x${panel.height}`,
    parts: parts.length,
    carried: 0,
    containerDepth: 0,
    leavesBySlot: {},
    overlapsBefore: overlapsOn(parts, undefined, panel).length,
    overlapsAfter: overlapsOn(after, undefined, panel).length,
    tidyMoves: plan.moves.length,
    tidyStuck: plan.stuck.length,
    criticOverlapBefore: count(screen, "geom.overlap"),
    criticOverlapAfter: count(withParts(screen, after), "geom.overlap"),
    criticAlignBefore: count(screen, "geom.alignment"),
    criticAlignAfter: count(withParts(screen, after), "geom.alignment"),
    offGrid: parts.filter(off).length,
    offGridAfterTidy: after.filter((p) => moved.has(p.UniqueId) && off(p)).length,
    outOfPanel: parts.filter((p) => p.Location.Left < 0 || p.Location.Top < 0 || p.Location.Left + (p.Width ?? 0) > panel.width + 0.5 || p.Location.Top + (p.Height ?? 0) > panel.height + 0.5).length,
    paths,
    libraryDropOffPanel: dropTop + size > panel.height,
    frameDiffersFromFirst: panel.width !== first.width || panel.height !== first.height,
    nearMiss: nearMisses(parts),
    onGrid: Object.fromEntries([1, 2, 4, 5, 8, 10, 16].map((g) => [g, parts.filter((p) => p.Location.Left % g === 0 && p.Location.Top % g === 0).length])),
    fractional: parts.filter((p) => !Number.isInteger(p.Location.Left) || !Number.isInteger(p.Location.Top) || !Number.isInteger(p.Width ?? 0) || !Number.isInteger(p.Height ?? 0)).length,
    outNames: file.startsWith("generated:") ? parts.filter((p) => p.Location.Left < 0 || p.Location.Top < 0 || p.Location.Left + (p.Width ?? 0) > panel.width + 0.5 || p.Location.Top + (p.Height ?? 0) > panel.height + 0.5).map((p) => `${p.Name}@${p.Location.Left},${p.Location.Top} ${p.Width}x${p.Height}`) : [],
    perturb: perturb(parts, panel),
    ...extra,
  };
}

async function main() {
  const [out, ...files] = process.argv.slice(2);
  const rows: ScreenStats[] = [];
  const text: Record<string, { h: Record<string, number>; v: Record<string, number> }> = {};
  const projects: Record<string, unknown> = {};

  const split = files.indexOf("--ours");
  for (const [i, f] of files.entries()) {
    if (f === "--ours") continue;
    const name = (split >= 0 && i > split ? "ours:" : "") + path.basename(f);
    try {
      const read = await readProject(new Uint8Array(fs.readFileSync(f)), name);
      const first = rootBox(read.screens[0]?.Children[0] ?? {}, read.target);
      const h: Record<string, number> = {};
      const v: Record<string, number> = {};
      read.screens.forEach((screen, i) => {
        const kept = read.preserved.screens.get(screen.UniqueId);
        const rawView = ((kept?.raw.Children as Raw[] | undefined) ?? [])[0] ?? {};
        tallyText(kept?.raw, h, v);
        const leavesBySlot: Record<string, number> = {};
        for (const l of kept?.tree?.laid.leaves ?? []) leavesBySlot[l.slot.kind] = (leavesBySlot[l.slot.kind] ?? 0) + 1;
        rows.push(measure(name, i, screen, read.target, first, {
          carried: read.foreign[screen.UniqueId]?.length ?? 0,
          containerDepth: depthOf(rawView),
          leavesBySlot,
          root: String(rawView.Type ?? screen.Children[0].Type),
        }));
      });
      text[name] = { h, v };
      projects[name] = { panel: `${read.target.model} ${read.target.width}x${read.target.height}`, screens: read.screens.length, carriedScreens: read.carried.screens, carriedRoots: read.carried.roots, opaqueParts: read.carried.opaqueParts };
    } catch (e) {
      projects[name] = { error: (e as Error).message.split("\n")[0] };
    }
  }

  // The fixture the canvas test draws.
  rows.push(measure("fixture:pump-station.screen.json", 0, demoScreen, { width: 1024, height: 600 }, rootBox(demoScreen.Children[0])));

  // What the app generates itself, on every panel in lib/backend/panels.ts.
  const tag = (Name: string, DataType: Variable["DataType"] = "BOOL"): Variable => ({ Name, DataType, Comments: "", DeviceAddress: "" });
  const variables = [101, 102, 103, 104, 105, 106, 107].flatMap((i) => [tag(`PMP_${i}_RUN`), tag(`PMP_${i}_FLT`), tag(`FT_${i}_PV`, "REAL"), tag(`PT_${i}_PV`, "REAL")]);
  const equipment = inferEquipment(variables);
  for (const panel of [{ width: 1024, height: 600 }, { width: 800, height: 600 }, { width: 640, height: 480 }, { width: 320, height: 240 }]) {
    const built = layoutApplication(fallbackPlan("plant", equipment).screens, equipment, panel);
    built.forEach((b, i) => rows.push(measure(`generated:${panel.width}x${panel.height}`, i, b.screen, panel, panel)));
  }

  const sum = (pick: (r: ScreenStats) => number, filter: (r: ScreenStats) => boolean = () => true) => rows.filter(filter).reduce((n, r) => n + pick(r), 0);
  const groups = { engineer: (r: ScreenStats) => !/^(generated|fixture|ours):/.test(r.file), ours: (r: ScreenStats) => r.file.startsWith("ours:"), generated: (r: ScreenStats) => r.file.startsWith("generated:"), fixture: (r: ScreenStats) => r.file.startsWith("fixture:") };
  const totals = Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, {
    screens: rows.filter(g).length,
    parts: sum((r) => r.parts, g),
    carried: sum((r) => r.carried, g),
    screensWithOverlap: rows.filter((r) => g(r) && r.overlapsBefore > 0).length,
    overlapsBefore: sum((r) => r.overlapsBefore, g),
    overlapsAfter: sum((r) => r.overlapsAfter, g),
    tidyMoves: sum((r) => r.tidyMoves, g),
    tidyStuck: sum((r) => r.tidyStuck, g),
    criticOverlapBefore: sum((r) => r.criticOverlapBefore, g),
    criticOverlapAfter: sum((r) => r.criticOverlapAfter, g),
    criticAlignBefore: sum((r) => r.criticAlignBefore, g),
    criticAlignAfter: sum((r) => r.criticAlignAfter, g),
    offGrid: sum((r) => r.offGrid, g),
    offGridAfterTidy: sum((r) => r.offGridAfterTidy, g),
    outOfPanel: sum((r) => r.outOfPanel, g),
    containerScreens: rows.filter((r) => g(r) && r.containerDepth > 0).length,
    maxDepth: Math.max(0, ...rows.filter(g).map((r) => r.containerDepth)),
    leavesInCells: sum((r) => r.leavesBySlot.cell ?? 0, g),
    leavesInStacks: sum((r) => r.leavesBySlot.stack ?? 0, g),
    leavesInCanvases: sum((r) => r.leavesBySlot.canvas ?? 0, g),
    libraryDropOffPanel: rows.filter((r) => g(r) && r.libraryDropOffPanel).length,
    framesDifferFromFirst: rows.filter((r) => g(r) && r.frameDiffersFromFirst).length,
    nearMiss: sum((r) => r.nearMiss, g),
    onGrid: Object.fromEntries([1, 2, 4, 5, 8, 10, 16].map((n) => [n, sum((r) => r.onGrid[n], g)])),
    fractional: sum((r) => r.fractional, g),
    outNames: rows.filter(g).flatMap((r) => r.outNames),
    perturb: Object.fromEntries(Object.keys(rows[0]?.perturb ?? {}).filter((k) => k !== "meanDisplacement").map((k) => [k, sum((r) => (r.perturb as Record<string, number>)[k], g)])),
  }]));
  fs.writeFileSync(out, JSON.stringify({ projects, totals, text, rows }, null, 1));
  console.log(JSON.stringify({ projects, totals, text }, null, 1));
}

main();
