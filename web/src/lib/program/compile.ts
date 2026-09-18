/**
 * A Screen Program into a screen: the compiler.
 * docs/ARCHITECTURE_SCREEN_QUALITY.md §3.4 and §3.7.
 *
 * The frame comes from the same chrome every generated screen shares. A KPI
 * band is KpiTile composites across the top of the body. A process band is
 * the graph laid out left to right by lib/program/topology: an
 * EquipmentSymbol composite per node, a Pipe per edge drawn as an elbow
 * from the source's right edge to the target's left, and an AnalogIndicator
 * callout under each node that has a reading. Everything is a composite or
 * a part the packager writes, on the Standard pack, on the grid.
 */

import type { PlantModel } from "@/lib/plant/model";
import { Placer, chrome, FOOTER, GAP, HEADER, MARGIN, NAV, type LaidOutScreen, type ScreenSpec } from "@/lib/ote/layout";
import { pipeRun, screenOf } from "@/lib/ote/parts";
import { orderLayers, placeGraph } from "./topology";
import type { ScreenProgram } from "./program";

const NODE = { width: 120, height: 128 };
const CALLOUT = { width: 176, height: 56 };
const KPI = { width: 208, height: 104 };

/** The program as the ScreenSpec the navigation strip lists it by. */
export function specOf(program: ScreenProgram): ScreenSpec {
  return {
    screenName: program.name,
    title: program.title,
    level: program.level,
    include: program.process?.nodes ?? [],
    sections: [],
  };
}

export function compileProgram(
  program: ScreenProgram,
  model: PlantModel,
  panel: { width: number; height: number },
  navigation: ScreenSpec[],
  graphics: Map<string, { Commands: string; Points: string }> = new Map(),
  place: Placer = new Placer(),
): LaidOutScreen {
  place.begin();
  const spec = specOf(program);
  chrome(place, spec, navigation, panel);

  let top = HEADER + NAV + GAP;
  const bottom = panel.height - FOOTER - GAP;
  const byId = new Map(model.equipment.map((e) => [e.id, e]));
  const notes: string[] = [];

  // --- KPI band ------------------------------------------------------------
  if (program.kpis.length > 0) {
    const perRow = Math.max(1, Math.floor((panel.width - MARGIN * 2 + GAP) / (KPI.width + GAP)));
    program.kpis.forEach((kpi, i) => {
      const column = i % perRow;
      const row = Math.floor(i / perRow);
      place.composite(
        "KpiTile",
        { label: kpi.label, tag: kpi.tag, units: kpi.units, decimals: kpi.decimals, trend: kpi.trend },
        { left: MARGIN + column * (KPI.width + GAP), top: top + row * (KPI.height + GAP), ...KPI },
        `Kpi_${kpi.tag.replace(/[^A-Za-z0-9]/g, "")}`,
      );
    });
    top += Math.ceil(program.kpis.length / perRow) * (KPI.height + GAP);
  }

  // --- process band ----------------------------------------------------------
  if (program.process) {
    const { nodes, edges } = program.process;
    let { callouts } = program.process;
    const areaHeight = bottom - top;
    // Fit the graph to the area, giving things up in order: the callouts
    // first (the faceplates still carry every reading), then symbol height,
    // never the panel edge. The log says which.
    const rows = Math.max(1, ...orderLayers(nodes, edges).map((c) => c.length));
    let node = { ...NODE };
    let rowPitch = node.height + (callouts.length > 0 ? CALLOUT.height + GAP : 0) + GAP;
    if (rows * rowPitch - GAP > areaHeight && callouts.length > 0) {
      notes.push(`${program.title}: ${callouts.length} callouts left off, the ${rows} rows of symbols need the room; the readings are on the faceplates`);
      callouts = [];
      rowPitch = node.height + GAP;
    }
    if (rows * rowPitch - GAP > areaHeight) {
      const height = Math.max(64, Math.floor((areaHeight - (rows - 1) * GAP) / rows / 8) * 8);
      notes.push(`${program.title}: symbols drawn at ${height}px to fit ${rows} rows`);
      node = { width: Math.max(64, Math.round((NODE.width * height) / NODE.height / 8) * 8), height };
      rowPitch = height + GAP;
    }
    const calloutFor = new Map(callouts.map((c) => [c.equipment, c]));
    const placed = placeGraph(
      nodes,
      edges,
      { left: MARGIN + 16, top, width: panel.width - MARGIN * 2 - 32, height: areaHeight },
      { width: Math.max(node.width, callouts.length > 0 ? CALLOUT.width : 0), height: node.height },
      { column: Math.max(node.width, callouts.length > 0 ? CALLOUT.width : 0) + 96, row: rowPitch },
    );
    const boxOf = new Map(placed.map((p) => [p.id, { left: p.left, top: p.top, ...node }]));

    // Pipes first, so the symbols paint over their ends.
    for (const edge of edges) {
      const a = boxOf.get(edge.from);
      const b = boxOf.get(edge.to);
      if (!a || !b) continue;
      const start = { x: a.left + a.width, y: a.top + a.height / 2 };
      const end = { x: b.left, y: b.top + b.height / 2 };
      const midX = Math.round((start.x + end.x) / 2);
      const points =
        start.y === end.y
          ? [start, end]
          : [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
      place.add(pipeRun(`Pipe_${safe(edge.from)}_${safe(edge.to)}`, points));
    }

    for (const p of placed) {
      const e = byId.get(p.id);
      const box = boxOf.get(p.id)!;
      const runTag = e?.roles.find((r) => r.role === "running")?.tag;
      const faultTag = e?.roles.find((r) => r.role === "fault")?.tag;
      const graphic = e?.symbol ? graphics.get(e.symbol) : undefined;
      place.composite(
        "EquipmentSymbol",
        { label: e?.label ?? p.id, runTag, faultTag, graphic },
        box,
        `Sym_${safe(p.id)}`,
      );
      const callout = calloutFor.get(p.id);
      if (callout && e) {
        const range = e.ranges[callout.tag];
        place.composite(
          "AnalogIndicator",
          {
            label: callout.label,
            tag: callout.tag,
            units: range?.units ?? "",
            min: range?.min ?? 0,
            max: range?.max ?? 100,
            normalLow: range?.normalLow ?? 20,
            normalHigh: range?.normalHigh ?? 80,
            decimals: 1,
          },
          { left: box.left, top: box.top + node.height + GAP / 2, ...CALLOUT },
          `Ind_${safe(callout.tag)}`,
        );
      }
    }
  }

  const screen = screenOf(program.name, place.parts, panel);
  const wires = place.wires.map((w) => ({ ...w, screenId: screen.UniqueId }));
  return {
    screen,
    parts: place.parts,
    wires,
    composites: place.composites.map((c) => ({ ...c, screenId: screen.UniqueId })),
    notes,
  };
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");
