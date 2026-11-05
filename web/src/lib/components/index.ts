import type { Box } from "@/lib/ote/parts";
import type { Expanded } from "@/lib/composites";
import { DEFAULT_THEME, type Density, type Theme } from "./theme";
import { assertBenched } from "./bench";
import { COMPONENT_KINDS, type Backend, type ComponentDef, type ComponentKind, type ComponentUse, type SizeName } from "./types";
import { Tank } from "./catalogue/tank";
import { Pump } from "./catalogue/pump";
import { Valve } from "./catalogue/valve";
import { Motor } from "./catalogue/motor";
import { Trend } from "./catalogue/trend";
import { Gauge } from "./catalogue/gauge";
import { Bar } from "./catalogue/bar";
import { AlarmBanner } from "./catalogue/alarmBanner";
import { NavBar } from "./catalogue/navBar";
import { StatusTile } from "./catalogue/statusTile";

export { BENCHED_PARTS } from "./bench";
export { DEFAULT_THEME, densityOf } from "./theme";
export { COMPONENT_KINDS } from "./types";
export type { ComponentKind, ComponentUse, SizeName, ComponentDef, Backend } from "./types";

export const COMPONENTS: Record<ComponentKind, ComponentDef<any>> = {
  Tank, Pump, Valve, Motor, Trend, Gauge, Bar, AlarmBanner, NavBar, StatusTile,
};

export function isComponentKind(value: string): value is ComponentKind {
  return (COMPONENT_KINDS as readonly string[]).includes(value);
}

export function sizeFor(kind: ComponentKind, variant: string, size: SizeName, density: Density = "regular") {
  const override: Partial<Record<ComponentKind, Partial<Record<string, Record<SizeName, { width: number; height: number }>>>>> = {
    Pump: { withSpeed: { S: { width: 184, height: 96 }, M: { width: 240, height: 120 }, L: { width: 320, height: 160 } } },
    Valve: { control: { S: { width: 184, height: 96 }, M: { width: 240, height: 120 }, L: { width: 320, height: 160 } } },
    Motor: { withDrive: { S: { width: 184, height: 104 }, M: { width: 240, height: 136 }, L: { width: 320, height: 184 } } },
    Bar: { horizontal: { S: { width: 184, height: 40 }, M: { width: 240, height: 56 }, L: { width: 320, height: 64 } }, deviation: { S: { width: 184, height: 40 }, M: { width: 240, height: 56 }, L: { width: 320, height: 64 } } },
  };
  const regular = override[kind]?.[variant]?.[size] ?? COMPONENTS[kind].sizes[size];
  const factor = density === "compact" ? 0.75 : density === "large" ? 1.25 : 1;
  return { width: Math.max(8, Math.round(regular.width * factor / 8) * 8), height: Math.max(8, Math.round(regular.height * factor / 8) * 8) };
}

/** No new compound-object definitions are written into a project. */
export function backendFor(_project: unknown, _kind: ComponentKind): Backend { return { kind: "parts" }; }

export function expandComponent(use: ComponentUse, box: Box, theme: Theme = DEFAULT_THEME, backend: Backend = { kind: "parts" }): Expanded {
  const def = COMPONENTS[use.kind];
  if (!def) throw new Error(`Unknown component ${use.kind}`);
  if (!def.variants.includes(use.variant)) throw new Error(`${use.kind} has no variant ${use.variant}`);
  if (backend.kind !== "parts") throw new Error(`${use.kind} has no benched ${backend.kind} backend`);
  if ([box.left, box.top, box.width, box.height].some((n) => n % theme.grid.unit !== 0)) throw new Error(`${use.kind} box must snap to ${theme.grid.unit} px`);
  const props = def.props.parse(use.props);
  const density = use.density ?? "regular";
  const scaledTheme = { ...theme, type: { ...theme.type, regular: theme.type[density] }, touchMin: { ...theme.touchMin, regular: theme.touchMin[density] } };
  const expanded = def.expand({ ...use, props }, box, scaledTheme, backend);
  assertBenched(expanded.parts);
  for (const part of expanded.parts) {
    const left = part.Location.Left, top = part.Location.Top;
    const width = part.Width ?? 0, height = part.Height ?? 0;
    if (left < box.left || top < box.top || left + width > box.left + box.width || top + height > box.top + box.height) {
      throw new Error(`${use.kind} part ${part.Name} leaves its component box`);
    }
  }
  return expanded;
}
