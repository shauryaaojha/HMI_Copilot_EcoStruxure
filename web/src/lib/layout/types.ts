import type { Op } from "@/core/ops";

export type SpaceId = "board" | "screen" | "panel" | "coInner" | "content" | "css";
export interface Transform { sx: number; sy: number; tx: number; ty: number }
export interface Box { left: number; top: number; width: number; height: number }
export interface Grid { unit: 1 | 2 | 4 | 8; origin: { x: number; y: number }; detected: boolean; coverage: number }
export type NodeKind = "project" | "screen" | "content" | "coDefinition" | "container" | "coInstance" | "composite" | "part";
export interface SceneNode {
  id: string;
  handle?: string;
  kind: NodeKind;
  type: string;
  name: string;
  box: Box;
  parent?: string;
  children: string[];
  slot?: { kind: "cell"; row: number; column: number; cell: Box } | { kind: "stack"; slot: Box } | { kind: "canvas" };
  inner?: { sceneId: string; toHost: Transform; uniform: boolean };
  locked?: boolean;
}
export interface Scene {
  id: string;
  kind: "screen" | "content" | "coDefinition";
  size: { width: number; height: number };
  toPanel: Transform;
  grid: Grid;
  nodes: Map<string, SceneNode>;
  roots: string[];
  hash: string;
}
export interface Unit {
  id: string;
  members: string[];
  box: Box;
  kind: "composite" | "card" | "coInstance" | "part";
  cellBound?: Box;
  /** A rectangle behind other parts: what lies wholly on it is on it, not over it. */
  backdrop?: boolean;
}
export type Edge = "left" | "centre" | "right" | "top" | "middle" | "bottom" | "baseline";
export type Constraint =
  | { id: string; kind: "align"; units: string[]; edge: Edge }
  | { id: string; kind: "distribute"; units: string[]; axis: "x" | "y"; gap?: number }
  | { id: string; kind: "sameSize"; units: string[]; dim: "width" | "height" | "both"; to?: string }
  | { id: string; kind: "inside"; unit: string; container: string; pad?: number }
  | { id: string; kind: "noOverlap"; scope: string[] | "screen" | { region: string } }
  | { id: string; kind: "snap"; scope: string[] | "screen" }
  | { id: string; kind: "keep"; units: string[] }
  | { id: string; kind: "row" | "column"; units: string[]; gap?: number };
export interface LayoutFacts {
  scene: { id: string; size: Box; panel: string; grid: Grid; scaleAssumption?: string };
  units: { id: string; kind: Unit["kind"]; type: string; parent?: string; box: Box; row?: string; column?: string }[];
  rows: { id: string; edge: Edge; at: number; units: string[]; gaps: number[] }[];
  columns: { id: string; edge: Edge; at: number; units: string[]; gaps: number[] }[];
  nearMisses: { a: string; b: string; edge: Edge; by: number }[];
  violations: ({ kind: "overlap"; a: string; b: string; w: number; h: number } | { kind: "outOfBounds" | "offGrid"; unit: string })[];
  room: string;
}
export interface Plan {
  moves: { unit: string; ids: string[]; from: Box; to: Box }[];
  ops: Op[];
  conflict?: { constraints: string[]; reason: string };
}
export interface Verification {
  ok: boolean;
  checks: { name: string; ok: boolean; before?: number; after?: number; ids?: string[] }[];
}
