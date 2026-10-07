/**
 * Layout containers: where a part inside a Grid, a StackPanel or a nested
 * Canvas actually lands on the screen, and how an edit gets back into them.
 *
 * Every screen EcoStruxure Operator Terminal Expert creates is rooted in a
 * `Grid` - Simple.eote, the one Schneider sent us, is a 10x8 grid with an
 * Ellipse at Row 2, Column 2 and no Left, Top, Width or Height at all. Until
 * this module the reader treated such a screen as unmodellable and carried it
 * whole, so any project made in the product opened to an empty editor.
 *
 * The approach is the one the rest of lib/ote takes: resolve at read, keep the
 * original, write back only what changed.
 *
 * - **Read.** `layoutTree` walks the container tree and gives every leaf an
 *   absolute box. The editor sees a flat list of parts at those boxes, which
 *   is the only shape it has ever needed.
 * - **Write.** `mergeTree` rebuilds the original tree. A part whose box did not
 *   move keeps its original Location, Margin, alignment and (absent) size, so
 *   it is still placed by its cell. A part that moved is pinned inside its
 *   cell with Left/Top alignment and a margin, which puts it exactly where the
 *   engineer dropped it. A new part goes into the root container the same way.
 *
 * The rules come from the product's own definitions, not from guessing:
 * `Buildtime/PropertyDefinitions/SystemEnums.enumdef` for the enums,
 * `00-LayoutObjects/Grid.propDef` for track syntax ("*" by default, "8", "0.5*").
 *
 *   ObjectAlignmentH  Left 1, Right 2, Stretch 3, Center 4
 *   ObjectAlignmentV  Top 32, Bottom 64, Stretch 3, Middle 128
 *   StackPanelOrientation  Vertical 0, Horizontal 1
 *
 * A part in a cell with no Width stretches across the cell. That is what 779 of
 * the 814 grid children in the typed corpus rely on: they carry no size and no
 * alignment, and they fill their cells in the product.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A grid's resolved tracks, so a moved part can be given a new cell. */
interface Tracks {
  /** Offsets of each row's top edge, plus the bottom edge: rows + 1 values. */
  rows: number[];
  cols: number[];
}

/** Where a leaf was placed from: a grid cell, a stack slot, or a canvas origin. */
export type Slot =
  | { kind: "cell"; box: Box; grid: Tracks; row: number; column: number }
  | { kind: "stack"; box: Box }
  | { kind: "canvas"; origin: { left: number; top: number } };

export interface Leaf {
  uid: string;
  raw: Record<string, unknown>;
  box: Box;
  slot: Slot;
}

export interface Laid {
  /** Leaves in tree order, which is also drawing order. */
  leaves: Leaf[];
  /** The root container's tracks, when it is a grid. New parts go here. */
  rootGrid: Tracks | null;
  rootBox: Box;
}

export const ALIGN_H = { left: 1, right: 2, stretch: 3, center: 4 } as const;
export const ALIGN_V = { top: 32, bottom: 64, stretch: 3, middle: 128 } as const;

const GRIDS = new Set(["Grid", "ScrollGrid"]);
const CANVASES = new Set(["Canvas", "ScrollCanvas", "ZoomCanvas"]);
/**
 * A GroupObject places its children by Left/Top inside its own box, exactly
 * as a canvas does (HVAC_Symbol01's PZH tag: a Path, a Line at Top 9 and a
 * TextBox, inside a 44x17 group). It is not a screen root, so it is laid out
 * as a canvas only when nested.
 */
const GROUPS = new Set(["GroupObject"]);
const STACKS = new Set(["StackPanel"]);
const UNIFORM = new Set(["UniformGrid"]);

/** True for the container types this module lays out. */
export const isContainerType = (type: unknown): boolean =>
  typeof type === "string" &&
  (GRIDS.has(type) || CANVASES.has(type) || GROUPS.has(type) || STACKS.has(type) || UNIFORM.has(type));

/**
 * True when a nested node holds other parts and places them itself. An empty
 * container has nothing to lay out and stays a carried object, drawn at its
 * own box, so the engineer still sees it is there.
 */
export const isContainer = (node: unknown): boolean =>
  isContainerType((node as { Type?: unknown })?.Type) &&
  Array.isArray((node as { Children?: unknown }).Children) &&
  ((node as { Children: unknown[] }).Children.length > 0);

/** A root a flat canvas can stand in for without losing anything. */
export const isFlatRoot = (view: Record<string, unknown>): boolean =>
  (view.Type === "ViewBox" || CANVASES.has(String(view.Type))) &&
  !(Array.isArray(view.Children) && view.Children.some(isContainer));

type Raw = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const children = (node: Raw): Raw[] => (Array.isArray(node.Children) ? (node.Children as Raw[]) : []);

/** "*", "", missing -> 1 star; "0.5*" -> 0.5 star; "8" -> 8px; "Auto" -> auto. */
function parseTrack(value: unknown): { px?: number; star?: number; auto?: true } {
  if (typeof value === "number") return { px: value };
  const s = typeof value === "string" ? value.trim() : "";
  if (s === "" || s === "*") return { star: 1 };
  if (/^auto$/i.test(s)) return { auto: true };
  if (s.endsWith("*")) {
    const n = Number(s.slice(0, -1));
    return { star: Number.isFinite(n) && n > 0 ? n : 1 };
  }
  const n = Number(s);
  return Number.isFinite(n) ? { px: n } : { star: 1 };
}

/** Resolve a list of track definitions into edge offsets across `length`. */
function resolveTracks(
  defs: unknown,
  key: "Height" | "Width",
  start: number,
  length: number,
  autoSize: (index: number) => number,
): number[] {
  const list = Array.isArray(defs) && defs.length > 0 ? defs : [{}];
  const tracks = list.map((d) => parseTrack(obj(d)[key]));
  const sizes = tracks.map((t, i) => t.px ?? (t.auto ? autoSize(i) : 0));
  const fixed = sizes.reduce((a, b) => a + b, 0);
  const stars = tracks.reduce((a, t) => a + (t.star ?? 0), 0);
  const unit = stars > 0 ? Math.max(0, length - fixed) / stars : 0;
  const edges = [start];
  tracks.forEach((t, i) => edges.push(edges[i] + (t.star !== undefined ? t.star * unit : sizes[i])));
  return edges;
}

/** A node's own box inside the slot its parent gave it. */
function placeIn(slot: Box, node: Raw): Box {
  const m = obj(node.Margin);
  const ml = num(m.Left) ?? 0;
  const mt = num(m.Top) ?? 0;
  const mr = num(m.Right) ?? 0;
  const mb = num(m.Bottom) ?? 0;
  const inner = {
    left: slot.left + ml,
    top: slot.top + mt,
    width: Math.max(0, slot.width - ml - mr),
    height: Math.max(0, slot.height - mt - mb),
  };
  const align = obj(node.ObjectAlignment);
  const w = num(node.Width);
  const h = num(node.Height);
  const ha = num(align.Horizontal);
  const va = num(align.Vertical);

  let left = inner.left;
  let width = inner.width;
  if (w !== undefined) {
    width = w;
    if (ha === ALIGN_H.left) left = inner.left;
    else if (ha === ALIGN_H.right) left = inner.left + inner.width - w;
    else left = inner.left + (inner.width - w) / 2;
  }
  let top = inner.top;
  let height = inner.height;
  if (h !== undefined) {
    height = h;
    if (va === ALIGN_V.top) top = inner.top;
    else if (va === ALIGN_V.bottom) top = inner.top + inner.height - h;
    else top = inner.top + (inner.height - h) / 2;
  }
  return { left, top, width, height };
}

/** Grid placement of a child: row, column and spans clamped to the tracks. */
function cellOf(node: Raw, rows: number, cols: number) {
  const loc = obj(node.Location);
  const row = Math.min(Math.max(0, num(loc.Row) ?? 0), rows - 1);
  const column = Math.min(Math.max(0, num(loc.Column) ?? 0), cols - 1);
  const rowSpan = Math.max(1, Math.min(num(loc.RowSpan) ?? 1, rows - row));
  const columnSpan = Math.max(1, Math.min(num(loc.ColumnSpan) ?? 1, cols - column));
  return { row, column, rowSpan, columnSpan };
}

/**
 * Every leaf of a screen's container tree, at its absolute box.
 *
 * `rootBox` is the screen: the panel, or the root's own size when it has one.
 */
export function layoutTree(root: Raw, rootBox: Box): Laid {
  const leaves: Leaf[] = [];
  let rootGrid: Tracks | null = null;

  const visit = (node: Raw, box: Box, isRoot: boolean) => {
    const type = String(node.Type);
    const kids = children(node);

    if (GRIDS.has(type)) {
      const rowsDef = node.Rows;
      const colsDef = node.Columns;
      const nRows = Array.isArray(rowsDef) && rowsDef.length > 0 ? rowsDef.length : 1;
      const nCols = Array.isArray(colsDef) && colsDef.length > 0 ? colsDef.length : 1;
      // Auto tracks size to the largest explicit size of a single-span child.
      const autoOf = (axis: "row" | "column") => (index: number) =>
        kids.reduce((best, k) => {
          const c = cellOf(k, nRows, nCols);
          const span = axis === "row" ? c.rowSpan : c.columnSpan;
          const at = axis === "row" ? c.row : c.column;
          const size = num(axis === "row" ? k.Height : k.Width);
          return span === 1 && at === index && size !== undefined ? Math.max(best, size) : best;
        }, 0);
      const grid: Tracks = {
        rows: resolveTracks(rowsDef, "Height", box.top, box.height, autoOf("row")),
        cols: resolveTracks(colsDef, "Width", box.left, box.width, autoOf("column")),
      };
      if (isRoot) rootGrid = grid;
      for (const kid of kids) {
        const c = cellOf(kid, nRows, nCols);
        const cell = {
          left: grid.cols[c.column],
          top: grid.rows[c.row],
          width: grid.cols[c.column + c.columnSpan] - grid.cols[c.column],
          height: grid.rows[c.row + c.rowSpan] - grid.rows[c.row],
        };
        place(kid, placeIn(cell, kid), { kind: "cell", box: cell, grid, row: c.row, column: c.column });
      }
      return;
    }

    if (CANVASES.has(type) || GROUPS.has(type)) {
      for (const kid of kids) {
        const loc = obj(kid.Location);
        const kidBox = {
          left: box.left + (num(loc.Left) ?? 0),
          top: box.top + (num(loc.Top) ?? 0),
          width: num(kid.Width) ?? 0,
          height: num(kid.Height) ?? 0,
        };
        place(kid, kidBox, { kind: "canvas", origin: { left: box.left, top: box.top } });
      }
      return;
    }

    if (STACKS.has(type)) {
      const horizontal = num(node.Orientation) === 1;
      let cursor = horizontal ? box.left : box.top;
      for (const kid of kids) {
        const m = obj(kid.Margin);
        const along = horizontal
          ? (num(kid.Width) ?? 0) + (num(m.Left) ?? 0) + (num(m.Right) ?? 0)
          : (num(kid.Height) ?? 0) + (num(m.Top) ?? 0) + (num(m.Bottom) ?? 0);
        const slot = horizontal
          ? { left: cursor, top: box.top, width: along, height: box.height }
          : { left: box.left, top: cursor, width: box.width, height: along };
        cursor += along;
        place(kid, placeIn(slot, kid), { kind: "stack", box: slot });
      }
      return;
    }

    if (UNIFORM.has(type)) {
      const n = Math.max(1, kids.length);
      let cols = num(node.Columns) ?? 0;
      let rows = num(node.Rows) ?? 0;
      if (cols <= 0 && rows <= 0) cols = Math.ceil(Math.sqrt(n));
      if (cols <= 0) cols = Math.ceil(n / rows);
      if (rows <= 0) rows = Math.ceil(n / cols);
      const w = box.width / cols;
      const h = box.height / rows;
      kids.forEach((kid, i) => {
        const slot = { left: box.left + (i % cols) * w, top: box.top + Math.floor(i / cols) * h, width: w, height: h };
        place(kid, placeIn(slot, kid), { kind: "stack", box: slot });
      });
    }
  };

  const place = (node: Raw, box: Box, slot: Slot) => {
    if (isContainer(node)) {
      visit(node, box, false);
      return;
    }
    const uid = typeof node.UniqueId === "string" ? node.UniqueId : "";
    leaves.push({ uid, raw: node, box, slot });
  };

  if (isContainerType(root.Type)) visit(root, rootBox, true);
  return { leaves, rootGrid, rootBox };
}

/** The flat part the editor sees for a leaf: the same object, at its box. */
export function flatten(leaf: Leaf): Raw {
  return {
    ...leaf.raw,
    Location: { Left: leaf.box.left, Top: leaf.box.top },
    Width: leaf.box.width,
    Height: leaf.box.height,
  };
}

/** True when the editor left a part where the layout put it. */
function samePlace(part: Raw, box: Box): boolean {
  const loc = obj(part.Location);
  return loc.Left === box.left && loc.Top === box.top && part.Width === box.width && part.Height === box.height;
}

/** The track a coordinate falls in, by edge offsets. */
const trackAt = (edges: number[], at: number) => {
  for (let i = 0; i < edges.length - 1; i++) if (at < edges[i + 1]) return i;
  return Math.max(0, edges.length - 2);
};

/** Pin a box inside a grid: its cell, Left/Top alignment, a margin and a size. */
function pinInGrid(node: Raw, box: Box, grid: Tracks, keep?: { row: number; column: number; cell: Box }): Raw {
  const inside =
    keep &&
    box.left >= keep.cell.left &&
    box.top >= keep.cell.top &&
    box.left < keep.cell.left + keep.cell.width &&
    box.top < keep.cell.top + keep.cell.height;
  const row = inside ? keep.row : trackAt(grid.rows, box.top);
  const column = inside ? keep.column : trackAt(grid.cols, box.left);
  const location: Raw = inside ? { ...obj(node.Location) } : { Left: null, Top: null, Row: row, Column: column };
  if (!inside) {
    // A part that left its cell drops its spans: it now lives in one cell.
    delete location.RowSpan;
    delete location.ColumnSpan;
  }
  return {
    ...node,
    Location: location,
    ObjectAlignment: { Horizontal: ALIGN_H.left, Vertical: ALIGN_V.top },
    Margin: { Left: Math.round(box.left - grid.cols[column]), Top: Math.round(box.top - grid.rows[row]) },
    Width: Math.round(box.width),
    Height: Math.round(box.height),
  };
}

/**
 * Write the editor's flat parts back into the original tree.
 *
 * `parts` is the screen's flat list after editing. A leaf that was modelled
 * and is no longer in it was deleted; one in it that the tree never had is new.
 * Leaves that were never modelled (`modelled` does not hold them) stay exactly
 * where they were.
 */
export function mergeTree(root: Raw, laid: Laid, parts: Raw[], modelled: Set<string>): Raw {
  const byId = new Map(parts.map((p) => [String(p.UniqueId), p]));
  const leafById = new Map(laid.leaves.map((l) => [l.uid, l]));

  const rebuild = (node: Raw): Raw => {
    const next: Raw[] = [];
    for (const kid of children(node)) {
      if (isContainer(kid)) {
        next.push(rebuild(kid));
        continue;
      }
      const uid = String(kid.UniqueId ?? "");
      if (!modelled.has(uid)) {
        next.push(kid);
        continue;
      }
      const edited = byId.get(uid);
      const leaf = leafById.get(uid);
      if (!edited || !leaf) continue; // deleted in the editor
      next.push(writeBack(kid, edited, leaf));
    }
    return { ...node, Children: next };
  };

  const merged = rebuild(root);

  // New parts go into the root, placed exactly where the editor put them.
  const added = parts.filter((p) => !leafById.has(String(p.UniqueId)));
  if (added.length > 0) {
    const extra = added.map((p) => {
      const loc = obj(p.Location);
      const box = { left: num(loc.Left) ?? 0, top: num(loc.Top) ?? 0, width: num(p.Width) ?? 0, height: num(p.Height) ?? 0 };
      if (laid.rootGrid) {
        const grid = laid.rootGrid;
        const rows = grid.rows.length - 1;
        const cols = grid.cols.length - 1;
        const location: Raw = { Left: null, Top: null, Row: 0, Column: 0 };
        if (rows > 1) location.RowSpan = rows;
        if (cols > 1) location.ColumnSpan = cols;
        return {
          ...p,
          Location: location,
          ObjectAlignment: { Horizontal: ALIGN_H.left, Vertical: ALIGN_V.top },
          Margin: { Left: Math.round(box.left - laid.rootBox.left), Top: Math.round(box.top - laid.rootBox.top) },
          Width: Math.round(box.width),
          Height: Math.round(box.height),
        };
      }
      return {
        ...p,
        Location: { Left: Math.round(box.left - laid.rootBox.left), Top: Math.round(box.top - laid.rootBox.top) },
      };
    });
    merged.Children = [...children(merged), ...extra];
  }
  return merged;
}

/** One modelled leaf: its edits over the original, geometry kept if unmoved. */
function writeBack(raw: Raw, edited: Raw, leaf: Leaf): Raw {
  const node: Raw = { ...raw, ...edited };
  if (samePlace(edited, leaf.box)) {
    // Unmoved: the cell still places it, exactly as the product wrote it.
    node.Location = raw.Location;
    if ("Width" in raw) node.Width = raw.Width;
    else delete node.Width;
    if ("Height" in raw) node.Height = raw.Height;
    else delete node.Height;
    return node;
  }
  const loc = obj(edited.Location);
  const box = {
    left: num(loc.Left) ?? leaf.box.left,
    top: num(loc.Top) ?? leaf.box.top,
    width: num(edited.Width) ?? leaf.box.width,
    height: num(edited.Height) ?? leaf.box.height,
  };
  const slot = leaf.slot;
  if (slot.kind === "cell") {
    // The editor's Left/Top are absolute; the cell placement is the original's.
    return pinInGrid({ ...node, Location: raw.Location }, box, slot.grid, { row: slot.row, column: slot.column, cell: slot.box });
  }
  if (slot.kind === "stack") {
    return {
      ...node,
      Location: raw.Location,
      ObjectAlignment: { Horizontal: ALIGN_H.left, Vertical: ALIGN_V.top },
      Margin: { Left: Math.round(box.left - slot.box.left), Top: Math.round(box.top - slot.box.top) },
      Width: Math.round(box.width),
      Height: Math.round(box.height),
    };
  }
  return {
    ...node,
    Location: { ...obj(raw.Location), Left: Math.round(box.left - slot.origin.left), Top: Math.round(box.top - slot.origin.top) },
    Width: Math.round(box.width),
    Height: Math.round(box.height),
  };
}
