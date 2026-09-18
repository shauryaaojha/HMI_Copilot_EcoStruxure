/**
 * The Screen Program: what a screen shows, in words, with no coordinates.
 * docs/ARCHITECTURE_SCREEN_QUALITY.md §3.4.
 *
 * The document between judgement and geometry. The architect (deterministic
 * here; agent A2 writes the same schema) decides which screens exist and what
 * belongs on each; the compiler turns a program into parts through the
 * layout engine. Nothing in a program is a box, so nothing an agent could
 * write here can put an object off the panel or on top of another.
 */

import { z } from "zod";
import type { PlantModel } from "@/lib/plant/model";

export const Kpi = z.object({
  label: z.string(),
  tag: z.string(),
  units: z.string(),
  decimals: z.number().int().min(0).max(6),
  trend: z.boolean(),
});

export const Callout = z.object({
  /** The equipment the reading belongs beside. */
  equipment: z.string(),
  tag: z.string(),
  label: z.string(),
});

export const ProcessBand = z.object({
  /** Equipment ids, drawn as symbols. */
  nodes: z.array(z.string()).min(1),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
  callouts: z.array(Callout),
});

export const ScreenProgram = z.object({
  name: z.string(),
  title: z.string(),
  level: z.union([z.literal(1), z.literal(2)]),
  /** The unit an L2 screen is about; absent on an L1. */
  unit: z.string().optional(),
  kpis: z.array(Kpi),
  process: ProcessBand.optional(),
  /** Why this screen exists, one line, for the build log and the engineer. */
  rationale: z.string(),
});

export type Kpi = z.infer<typeof Kpi>;
export type Callout = z.infer<typeof Callout>;
export type ProcessBand = z.infer<typeof ProcessBand>;
export type ScreenProgram = z.infer<typeof ScreenProgram>;

const isReading = (dataType: string) => dataType !== "BOOL" && dataType !== "STRING";

/** The reading an operator would look at first: level, then flow, pressure, temperature, then anything. */
const HEADLINE = ["level", "flow", "pressure", "temperature", "speed", "value"];
function headline(model: PlantModel, equipmentId: string): { tag: string; role: string } | undefined {
  const e = model.equipment.find((x) => x.id === equipmentId);
  if (!e) return undefined;
  const readings = e.roles.filter((r) => isReading(r.dataType));
  for (const role of HEADLINE) {
    const hit = readings.find((r) => r.role === role);
    if (hit) return { tag: hit.tag, role: hit.role };
  }
  return readings[0] ? { tag: readings[0].tag, role: readings[0].role } : undefined;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const safe = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");

/**
 * Programs from the Plant Model, deterministically.
 *
 * One L2 process screen per unit that has something to connect: at least
 * two pieces of equipment and at least one connection between them. Units
 * with no connections keep the faceplate screens the plan already makes,
 * and the program says why there is no process view. An L1 overview when
 * there is more than one unit worth a screen: the headline reading of each
 * as a KPI tile, at most eight.
 */
export function architectPrograms(model: PlantModel): ScreenProgram[] {
  const programs: ScreenProgram[] = [];
  const byId = new Map(model.equipment.map((e) => [e.id, e]));

  for (const unit of model.units) {
    const members = unit.equipment.filter((id) => byId.get(id)?.class !== "instrument");
    const edges = model.connections.filter((c) => members.includes(c.from) && members.includes(c.to));
    if (members.length < 2 || edges.length === 0) continue;
    const callouts: Callout[] = [];
    for (const id of members) {
      const h = headline(model, id);
      const e = byId.get(id)!;
      if (h) callouts.push({ equipment: id, tag: h.tag, label: `${e.label} ${h.role}` });
    }
    programs.push({
      name: `${safe(unit.name)}Process`,
      title: `${unit.name} process`,
      level: 2,
      unit: unit.id,
      kpis: [],
      process: { nodes: members, edges: edges.map(({ from, to }) => ({ from, to })), callouts },
      rationale: `${members.length} connected pieces of equipment in ${unit.name}: shown as a process, in flow order`,
    });
  }

  if (programs.length > 1) {
    const kpis: Kpi[] = [];
    for (const program of programs) {
      const unit = model.units.find((u) => u.id === program.unit)!;
      for (const id of unit.equipment) {
        const h = headline(model, id);
        if (!h) continue;
        const e = byId.get(id)!;
        const range = e.ranges[h.tag];
        kpis.push({ label: `${e.label} ${titleCase(h.role)}`, tag: h.tag, units: range?.units ?? "", decimals: 1, trend: true });
        break;
      }
    }
    if (kpis.length > 0) {
      programs.unshift({
        name: "SiteOverview",
        title: "Site overview",
        level: 1,
        kpis: kpis.slice(0, 8),
        rationale: `${programs.length} units with a process view: one headline reading each`,
      });
    }
  }

  return programs;
}
