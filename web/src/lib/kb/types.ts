export type Layer = "code" | "docs" | "components" | "install" | "corpus" | "project";
export type Kind = "partType" | "property" | "component" | "pattern" | "rule" | "panel" | "driver" | "tagConvention" | "machineClass" | "symbol" | "example";

export interface Source {
  kind: "code" | "doc" | "standard" | "corpus" | "install";
  ref: string;
  inputHash: string;
}

export interface Entry<B = unknown> {
  id: string;
  kind: Kind;
  layer: Layer;
  title: string;
  summary: string;
  tags: string[];
  body: B;
  related: string[];
  source: Source;
  rev: string;
  support?: { count: number; projects: number };
}

export interface PartTypeBody {
  type: string;
  emitted: boolean;
  valueProperty?: string;
  accepts?: string[];
  defaultSize: { width: number; height: number };
  properties: string[];
}

export interface PanelBody { model: string; width: number; height: number; formats: string[]; viewing: string; from: "code" | "deviceInfo" | "file" }
export interface PatternBody { level: 1 | 2 | 3; zones: Record<string, number>; perPanel: { panel: string; columns: number; rows: number; cell: { width: number; height: number }; capacity: number }[] }
export interface RuleBody { statement: string; why: string; checker?: string; thresholds?: Record<string, number>; severity: "must" | "should" }

export interface Kb {
  get(id: string): Entry | undefined;
  byTag(tag: string, opts?: { kind?: Kind; limit?: number }): Entry[];
  search(q: string, opts?: { kinds?: Kind[]; tags?: string[]; limit?: number }): { entry: Entry; score: number }[];
  related(id: string, depth?: 1 | 2): Entry[];
  version: { schema: number; code: string; corpus?: string; install?: string };
}
