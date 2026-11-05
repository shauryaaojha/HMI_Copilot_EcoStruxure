import type { z } from "zod";
import type { Box } from "@/lib/ote/parts";
import type { Expanded } from "@/lib/composites";
import type { Density, Theme, Token } from "./theme";

export const COMPONENT_KINDS = ["Tank", "Pump", "Valve", "Motor", "Trend", "Gauge", "Bar", "AlarmBanner", "NavBar", "StatusTile"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];
export type SizeName = "S" | "M" | "L";
export type OpState = "running" | "stopped" | "opening" | "closing" | "open" | "closed" | "manual" | "auto" | "interlocked" | "disabled" | "unknown";
export interface RoleSlot { role: string; dataType: "BOOL" | "INT" | "REAL" | "STRING"; required: boolean }
export type Backend = { kind: "parts" } | { kind: "co"; definition: string; spec: string } | { kind: "exemplar"; exemplar: "pushbutton" | "toggle" | "entry" | "reading" | "status" };
export interface ComponentUse<P = Record<string, unknown>> {
  kind: ComponentKind;
  variant: string;
  size: SizeName;
  tags: Record<string, string>;
  props: P;
  place?: { region?: string; anchor?: string; side?: string };
  density?: Density;
  name?: string;
}
export interface ComponentDef<P = Record<string, unknown>> {
  kind: ComponentKind;
  variants: readonly string[];
  sizes: Record<SizeName, { width: number; height: number }>;
  states: readonly OpState[];
  alarmSlot?: "topLeft" | "topRight";
  roles: readonly RoleSlot[];
  tokens: readonly Token[];
  props: z.ZodType<P, z.ZodTypeDef, any>;
  backends: readonly Backend["kind"][];
  expand: (use: ComponentUse<P>, box: Box, theme: Theme, backend: Backend) => Expanded;
}
