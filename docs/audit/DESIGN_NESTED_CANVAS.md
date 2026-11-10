# Design A: a nested canvas and a grid the AI can do geometry on

Audit 2026-11, stream S5. Status when written: design only. Since built on `main` (a2d2f39): the layout solver in `web/src/lib/layout`, the 4 px grid, and the Layers tree with the Compound Object row. This text is the design, not a record of what shipped.

Shaurya's idea is a tree, like a DOM:
- one project canvas that holds every screen and Compound Object (CO);
- inside each screen, its own canvas at the panel's pixel size, with a fixed pixel grid;
- the AI reads the tree as numbers and returns exact ops that fix the alignment.

This document checks that idea against the code and the measured screens. The verdict: the idea is right.
Two changes make it work:
- The tree already exists in the reader, but the editor throws it away. Keep it, and derive one read model from it.
- The model must never do the geometry. It names intent as constraints. A deterministic solver in code computes
  the boxes, checks them, and only then emits ops.

All counts below come from `web/scripts/audit/s5-measure.mts`. The raw output is in the stream's scratch folder,
not in the repo. Engineer files are named by file name only: `auto&manua.eote`, `HMICopilot_Panel1.eote`,
`HMICopilot_Drive_4.1.eote` and `Motor_Drive_Control_4.1.eote` (26 screens, 577 modelled parts). "Ours" means
the tracked `demo_project/HMICopilot_{PumpStation,Bars,TS,Symbols}.eote` (7 screens, 223 parts). "Generated"
means `layoutApplication` on a 28-tag plant, on every panel in `lib/backend/panels.ts` (12 screens, 422 parts).

---

## 1. The problem, with evidence

### 1.1 The editor sees a flat list; the file is a tree

- The reader walks Grid, StackPanel, UniformGrid, Canvas and GroupObject containers. It flattens them into one
  list of leaves at absolute boxes (`web/src/lib/ote/containers.ts:14-21`, `198-296`;
  `web/src/lib/ote/reader.ts:232-288`). The real tree lives on only in `preserved.screens[id].tree`, and only for
  the writer.
- Everything that does geometry reads that flat list, `screen.Children[0].Children`:
  - ops: `web/src/core/ops/apply.ts:128,147,156,860`;
  - tidy: `web/src/lib/ote/tidy.ts:93-137`;
  - the critic: `web/src/lib/critic/geometry.ts:148-149`;
  - regions: `web/src/lib/ote/regions.ts:80-97`;
  - the canvas: `web/src/components/canvas/ScreenRenderer.tsx:273,320`;
  - layers: `web/src/components/inspector/LayersPanel.tsx:57`.
- Structure the file states is lost to the editor. Edits that depend on it are lost at export. Measured bug
  S5-01: a paint-order change on a Grid-rooted screen does not survive export, because `mergeTree` rebuilds
  children in their original order (`containers.ts:363-381`). Proof: `web/scripts/audit/s5-layers-order-lost.test.ts`.
- How deep the trees are in the engineer files:
  - 16 of 26 screens are Grid-rooted, with 74 leaves placed by Grid cell;
  - 0 screens nest a container below the root;
  - all nesting below the root is CO instances. They are modelled as `CompoundObject` parts drawn from their
    definition's own inner tree (`web/src/lib/ote/co-look.ts:1-29`, `ContentDisplay.tsx:87-129`).
  - so "screen, then container, then CO, then CO inner canvas" is the shape to design for.

### 1.2 Five coordinate spaces, mixed without a name

| Space | Unit | Where it lives today | Measured |
|---|---|---|---|
| Board (project canvas) | board units; frames at `placementOf`, gap 180 | `ScreenBoard.tsx:42-132` | grid cell sized from the first screen |
| Screen design space | the root's own units: ViewBox `Width`/`Height`, else the panel | `schema.ts:872-877` `rootBox` | 8 of 8 screens in `Motor_Drive_Control_4.1.eote` are 1024x600 ViewBoxes on a 1280x800 target |
| Panel pixels | the target's resolution | `Target.dat`, `read.target` | 4 of 4 engineer files target HMIST6600 at 1280x800. That model is not in `lib/backend/panels.ts:28-34` |
| Content-screen space | laid out at the size of the display that shows it | `reader.ts:192-197`, `247-252` | 8 of 26 engineer screens differ in size from the project's first screen. 66 of 577 parts have fractional coordinates (for example 796.875x397.5) |
| CO inner space | the definition's own units, scaled into the instance box (uniformly for a ViewBox root) | `co-look.ts:26-29`, `ContentDisplay.tsx:89-99` | every CO instance |
| CSS pixels | `zoom/100` CSS px per screen unit | `CanvasPane.tsx:512`, `ScreenRenderer.tsx:302-312` | the doc comment at `ScreenRenderer.tsx:110` says the inverse ("Screen units per CSS pixel") |

Consequences measured today:
- **S5-03.** The board is sized from two different screens.
  - `ScreenBoard` sizes cells from the first screen (`ScreenBoard.tsx:227-239`).
  - `CanvasPane` sizes them from the active screen and scrolls a double-click zoom by that size
    (`CanvasPane.tsx:185,289-297,364-376`).
  - With a 478x397.5 content screen active, frame 2 is drawn at y=1036 but the zoom aims at y=633.5.
  - Proof: `s5-board-placement.test.ts`.
- **The agent sees parent-local, mixed units.**
  - `screen_objects` reports `Location` as it stands in the file, which is relative to the parent.
  - For a Grid child it reports "cell r c" with no pixel box at all (`web/src/lib/agent/project.ts:124-133`,
    `web/src/lib/agent/tools.ts:390-399`).
  - In the engineer files 74 of 577 leaves (13%) have no pixel box the agent can read.

### 1.3 The grid unit the app assumes is not the grid the screens use

- The app assumes 8 px everywhere:
  - `store/types.ts:101` (`gridSize: 8`, `snap: true` by default);
  - `lib/ote/regions.ts:46`;
  - `lib/composites/index.ts:65`.
- Share of parts whose `Left` and `Top` are both multiples of g:

| g | engineer (577) | ours (223) | generated (422) |
|---|---|---|---|
| 1 (integer) | 521 (90%) | 223 (100%) | 422 (100%) |
| 2 | 440 (76%) | 216 (97%) | 397 (94%) |
| 4 | 324 (56%) | 171 (77%) | 263 (62%) |
| 8 | 127 (22%) | 64 (29%) | 79 (19%) |

- Our own layout engine is not on its 8 px grid either. `MARGIN` 12 (`layout.ts:112`) and text insets of
  +4/+6/+8 put text at odd multiples of 4.
- **Snap bug.** Drag-snap rounds the drag delta, not the position (`ScreenRenderer.tsx:314-317`, `354-355`).
  A part that starts off the grid moves in steps of 8 and never lands on it. That affects 78% of engineer
  parts with snap on, which is the default.

### 1.4 What the current tidy leaves behind

- On finished screens the current tools find nothing to do:
  - `overlapsOn` finds 0 overlaps on all 26 engineer, 7 ours and 12 generated screens;
  - the critic's `geom.alignment` finds 0 on the engineer screens.
- But 288 pairs of parts on the engineer screens have an edge or centre 1 to 3 px from the other's: lines that
  nearly meet. The same count is 84 on ours and 125 on generated. The critic misses them for three reasons
  (`critic/geometry.ts:305-330`):
  - it skips text;
  - it reads only `left` and `top`;
  - it needs a cluster of 3 or more.

The real damage comes when something moves. Each trial below pushes one object onto its neighbour, which is
what a chat `moveObject` with `dx` does by design (`apply.ts:627-633`). `planTidy` then runs, which is what
`tidyLayout` does. Up to 5 trials per screen:

| | engineer | generated |
|---|---|---|
| trials | 82 | 38 |
| overlap still there after tidy ("stuck") | 26 (32%) | 17 (45%) |
| moved object shared an x edge/centre with another before | 79 (96%) | 38 (100%) |
| ... and shares none after tidy | 66 (80%) | 20 (53%) |
| moved object shares no y edge/centre after tidy | 36 (44%) | 31 (82%) |
| trials that left a moved unit off the 8 px grid | 44 | 19 |
| near-miss pairs added | 50 | 21 |

Why:
- `planTidy` has one objective: no overlap. It searches `resolveSlot` positions in reading order on an 8 px
  lattice (`tidy.ts:197-248`, `regions.ts:144-166`, `201-290`). Alignment, gaps and the grid the screen uses are
  not in its objective.
- `alignTo` and `distribute` move single parts (`store/edits.ts:53-128`, `store/slices/objects.ts:187-218`),
  while the canvas selects a whole composite family (`ScreenRenderer.tsx:522-529`).
- **S5-02.** "Align left" on two selected analogue indicators collapses every member onto one x. Before, the
  members sat at offsets `0,8,8,64,168,252`. After, all six are at 0. Proof:
  `s5-align-collapses-composite.test.ts`.

### 1.5 What the model is told

- **Chat path (`lib/ai`).** The digest names objects by handle, type and region, never by position
  (`tidy.ts:4-8`). Overlaps reach the model as up to 12 sentences (`ai/converse.ts:217-222`). Free room reaches
  it as counts (`regions.ts:292-340`). No rows, columns, gaps or alignment groups.
- **Agent path (`lib/agent`).** There is no layout tool at all. The 30 tools at `agent/tools.ts:133-632` include:
  - `json_set` on `Location`, which is pixel arithmetic in the model's head, in parent-local units;
  - `view_screen`, which is a PNG.
- **MCP path.** `apply_ops`/`propose` carry the chat ops (`lib/mcp/write.ts:254,277`), so the same limits apply.
- Shaurya's diagnosis is right. The AI has no numbers to reason about. The one numeric fixer it can call
  optimises for overlap only.

---

## 2. The design

### 2.1 One tree, derived, not a second source of truth

The store stays flat. A flat list keyed by `UniqueId` is what these all edit:
- undo;
- the collab change log (`lib/collab/changes.ts`);
- proposals;
- the canvas.

Making the tree the store's model would rewrite every one of them. Instead, a pure function builds a `Scene`
from what already exists:
- the flat parts and `objectMeta`/`composites` from the store;
- the raw container tree from `preserved.screens[id].tree` (already in `ReadProject`);
- CO looks (`part.Look`);
- the content screens.

The scene is rebuilt per screen when the screen's hash changes. It is read by:
- the solver;
- the facts printer;
- the critic;
- later, the Layers panel, which can then show the tree.

Writes still go through ops, which go through the store and then `mergeTree`. `mergeTree` itself is fixed to
honour sibling order (S5-01).

```
Project canvas (board)               space: board units, frames at FrameOf(screen)
 ├─ Screen "s1"                       space: screen design units (root W/H), panel transform to panel px
 │   ├─ Container Grid (root)         tracks resolved by layoutTree; children placed by cell
 │   │   ├─ Leaf Part                 box in screen space; slot = cell r,c + margin
 │   │   └─ CO instance               box in screen space; inner = CO definition scene (read-only)
 │   │        └─ (inner leaves)       space: definition units, transform into the instance box
 │   ├─ Composite (our group)         unit of movement; members are leaves
 │   └─ ContentDisplay → Content "c3" content scene rendered in the display box (stretch)
 └─ CO definition "Switch_PB04"       one canvas per definition, at its own size (board row of COs)
```

### 2.2 Coordinate spaces and how they convert

There is one canonical space per scene: **screen design units (SDU)**. That is the root's `Width`/`Height` when
it has them (ViewBox), else the panel. Every box the solver, the facts and the ops use is in SDU of the screen
it is on. Conversions are affine (scale plus translate). No rotation: rotation of round shapes is folded into
angles at read (`co-look.ts:264-271`).

| From to | Transform |
|---|---|
| local (child of container) to SDU | Grid: `cell.origin + margin + align offset` (`containers.ts:146-181`). Canvas/Group: `parent.origin + Location`. Stack: cursor. Computed once by `layoutTree` |
| SDU to panel px | ViewBox root: uniform `s = min(Pw/W, Ph/H)`, centred (letterbox), as the product and `co-look.ts:46` do. Canvas/Grid root: identity |
| CO inner to SDU | `instance.box.origin + s * (p - look.origin)`. `s` is uniform and centred for a ViewBox root, else per-axis stretch (`ContentDisplay.tsx:96-97`) |
| content screen to host SDU | `display.box.origin + (p * display.size / content.size)`, per-axis (`ContentDisplay.tsx:66-72`, `preserveAspectRatio="none"`) |
| SDU to CSS px (single view) | `p * zoom/100`. Pointer to SDU stays as `ScreenRenderer.tsx:302-312` does it (via the SVG's own rect) |
| SDU to board units | `frame.origin + p` (board units = SDU of each frame; frames of different SDU sizes keep their own size) |

The board gets its own per-frame size. Its grid cell is the largest frame, or frames pack by row, never the
first screen's size. This fixes S5-03 by construction: one `boardLayout(screens)` is used by both `CanvasPane`
and `ScreenBoard`.

### 2.3 How a CO's inner canvas nests in a screen

- A CO *definition* is one scene: its own canvas, its own size, its own grid. It sits on the project canvas
  beside the screens, in a "Compound Objects" row. Editing a definition is a separate scope (the `.co` writer
  path, `lib/ote/co.ts`). It is out of scope for the screen solver.
- A CO *instance* is one movable, resizable unit in its host screen. Its inner leaves become facts, read-only:
  - its inner text and value boxes transformed to SDU, so that "align the value of PB04 with the label beside
    it" can be a constraint on an inner anchor;
  - the solver only ever writes the instance's own `Location`/`Width`/`Height`.
- Resizing an instance is allowed only within the aspect rule:
  - a ViewBox-rooted definition scales uniformly, so a non-uniform resize changes the margins, not the content;
  - the solver keeps aspect unless the constraint says `allowStretch`.

### 2.4 The grid unit

- Each scene has a `grid`: `{ unit, origin }`.
- The default unit for *new* screens and generated layouts is **4 px**. The generated layout's own constants
  are already multiples of 4 except the text insets, which phase 4 moves to 4.
- For an *opened* screen the unit is detected, not imposed. It is the largest g in {8, 4, 2, 1} that holds for
  at least 70% of the screen's leaves. On the engineer screens that gives 2 px on most and 1 px where
  fractional content sizes appear. That is honest: an engineer's screen built on a 2 px habit is not "off grid".
- The solver snaps only what it moves, to the scene's unit. It never re-snaps untouched parts.
- Canvas snap is fixed to snap the *position* (`round(start + dx)`), not the delta.
- Fractional coordinates (content screens laid out at a fractional display size) are kept as read and never
  rounded unless moved. Rounding them would shift a whole content screen by sub-pixels on export.

### 2.5 The layout facts given to the AI: a constraint list, not a picture

`layoutFacts(scene, scope)` prints a compact, deterministic table. Every number is in SDU. Ids are the existing
handles (`o12`, `s2`), so ops can name them.

```
screen s2 1024x600 SDU (panel 1280x800, scale 1.25) grid 4
units (id kind type parent box  [row col]):
 u1 card   Rectangle  -      12,84,320x162   r1 c1   members o14..o22
 u2 co     Switch_PB04 grid  400,96,120x48   r1 c2
 u3 part   TextBox    u1     24,92,180x20
rows:    r1 top=84 {u1,u4,u7} gaps 16,16 | r2 top=262 {u10,u11} gaps 16
columns: c1 left=12 {u1,u10} | c2 left=348 {u4,u11}
near-misses: u5.left=350 vs c2.left=348 (2) ; u9.middle=301 vs u8.middle=300 (1)
violations: overlap u12/u13 40x18 ; outOfBounds u20 right=1030>1024 ; offGrid u5 (unit 4)
free: body 3 card cells; header room for 2 small objects   (from regions.ts roomReport)
```

Detection is plain arithmetic:
- rows and columns are clusters of unit edges or centres within `alignmentSlop` (the pack's 4 px,
  `standard/pack.ts:146`), with 2 or more members;
- gaps are measured between consecutive members;
- near-misses are pairs with an edge 0 < d <= slop.

The model's answer is a list of **constraints**, never coordinates:

```
align(units, edge)                 edge: left|centre|right|top|middle|bottom|baseline
distribute(units, axis, gap?)      equal gaps; with gap, exactly that gap
sameSize(units, dim)               width|height|both, to the median or to a named unit
inside(unit, container, pad?)
noOverlap(scope)                   the screen, a region, or a set
snap(scope)                        to the scene's grid unit
keep(units)                        pinned: the solver may not move them
row(units) / column(units)         shorthand: align middle + distribute; align left + distribute
```

### 2.6 The solver: deterministic, in code, per axis

Choice: **a per-axis difference-constraint solver with union-find for equalities**, written in this repo
(about 400 lines). It is not an ILP, and it is not Cassowary.

Why:
- **The constraints are linear, and one axis at a time.**
  - align and sameSize are equalities between edge variables;
  - distribute with a gap, inside and noOverlap-once-ordered are `x_j - x_i >= c` or `= c`;
  - that is a system of difference constraints, solved exactly by shortest paths (Bellman-Ford) on the
    constraint graph;
  - a negative cycle *is* a conflict, and the cycle names the constraints that conflict. So a refusal is
    explainable ("align left u3,u4 conflicts with inside u4 card u1").
- **The one disjunction is overlap removal.** "Left of OR above" is where an ILP would need big-M binaries and a
  MIP solver. Instead it is decided deterministically before solving:
  - separate along the axis of least penetration, ordered by current centres;
  - this is what `tidy.ts` does today, but done for all pairs at once, inside the same system that holds the
    alignments, so a fix cannot break a row.
- **The objective is minimal movement.** Equality classes take the median of their members' current values.
  Each free unit's value is its current one, projected onto the feasible set by the shortest-path potentials
  from a source pinned at the current positions. The result is deterministic, needs no tie-breaking from a
  numerical solver, and comes out the same on the server and in the browser.
- **The size is small.**
  - The largest screen measured has 114 parts (one screen of `HMICopilot_Panel1.eote`). Units are fewer, because
    composites and cards move whole.
  - Bellman-Ford at V=150 and E of about 2,000 is under a millisecond.
  - No dependency is needed, and `package.json` has none for this.
- **Rejected alternatives:**
  - Cassowary (`kiwi.js`) handles strengths, which this does not need in phase 1. It adds a dependency and is
    still order-sensitive.
  - glpk/ILP wasm (about 1 MB) is overkill for difference constraints and harder to make deterministic.
  - Revisit only if the solver must trade off soft constraints (phase 5).

Order of work inside one solve:
1. Build units with `moveSetOf` semantics (`tidy.ts:140-156`): composite, card with contents, CO instance,
   or leaf. Grid-cell leaves carry a `cell` bound (`withinCell`, so the writer's margin stays in the cell).
2. Equalities through union-find: align, sameSize, row/column.
3. Inequalities: inside, distribute, noOverlap (decided as above), panel bounds, keep (as equality to the
   current value).
4. Bellman-Ford per axis. On a negative cycle, return `conflict` with the constraint ids on the cycle.
5. Snap moved units to the scene grid. Re-run step 4 with the snapped values pinned. If that is infeasible, snap
   by at most `unit/2` in the free direction.
6. Verify (2.8). Emit ops.

### 2.7 How the agent tools call it

There is one library, `lib/layout/solve.ts`. It is pure, with no store and no network. Three entry points sit
over it:

| Caller | Read | Write |
|---|---|---|
| Chat (`lib/ai`, `core/ops`) | digest gains `layoutFacts` for the active screen (capped at 60 units, then by region) | new op `arrange { screen, constraints[] }`. `alignObjects` and `tidyLayout` become thin aliases that build constraints (align over *units*, noOverlap+keepRows+snap) |
| Agent (`lib/agent`, raw workspace) | tool `layout_facts(screen, scope?)` | tool `layout_solve(screen, constraints, apply=false)` returns the plan and the verification. `apply=true` writes through `readProject` then ops then `packageProject`, the way `bind()` already does (`agent/project.ts:225-236`), never by `json_set` on `Location` |
| MCP (`lib/mcp`) | read tool `get_layout(project, screen)` | the `arrange` op through `apply_ops`/`propose` (wire format unchanged: ops are already a list of objects) |
| Canvas toolbar | | Align, Distribute and a new "Tidy" call the same solver with units from the selection (fixes S5-02) |

The model never sends a number except a gap it was asked for ("16 px apart"). An `arrange` op with coordinates
is refused, as `coerceTurn` already drops coordinates on add ops (`lib/ai/ops.ts:209-216`).

### 2.8 How a fix is checked before it is applied

The solve runs against a copy (`core/ops/apply.ts` `dryRun`, line 1016). It is accepted only if every hard check
passes:

| Check | Pass rule |
|---|---|
| Asked constraints | every constraint's residual is 0 (exact, in SDU) |
| Untouched invariance | every unit not in scope keeps its box to the bit |
| Containment | every card still holds its contents. Every Grid-cell leaf is still inside its cell |
| Overlaps | `overlapsOn` count after <= before, and 0 inside the scope when noOverlap was asked |
| Alignment kept | rows and columns detected before, with no member in scope, still exist |
| Near-misses | count after <= before in the scope |
| Bounds | no unit outside the scene's root box |
| Grid | every moved unit on the scene's grid unit (or the documented half-unit fallback) |
| Critic | `critiqueGeometry` score after >= before |

The result is a `Verification` (2.9). On pass:
- the ops become a proposal with ghosts, which `ScreenRenderer.tsx:571-584` already draws for `moved`;
- they commit as one undo step when review is off (`lib/ai/review.ts`).

On fail, nothing is applied and the reason goes back to the model as text: the failing check and the ids.
The agent gets one repair pass, as chat does today.

### 2.9 Data structures

```ts
// lib/layout/types.ts
export type SpaceId = "board" | "screen" | "panel" | "coInner" | "content" | "css";

/** p' = p * scale + offset, per axis. Uniform scale for ViewBox roots and ViewBox-rooted COs. */
export interface Transform { sx: number; sy: number; tx: number; ty: number }

export interface Box { left: number; top: number; width: number; height: number } // always SDU of its scene

export interface Grid { unit: 1 | 2 | 4 | 8; origin: { x: number; y: number }; detected: boolean; coverage: number }

export type NodeKind = "project" | "screen" | "content" | "coDefinition" | "container" | "coInstance" | "composite" | "part";

export interface SceneNode {
  id: string;               // UniqueId; composites use their instance id
  handle?: string;          // o12 / s2, from the store
  kind: NodeKind;
  type: string;             // Part Type, container Type, "CompoundObject.<Def>", composite kind
  name: string;
  box: Box;                 // in the scene's SDU
  parent?: string;
  children: string[];
  slot?: { kind: "cell"; row: number; column: number; cell: Box } | { kind: "stack"; slot: Box } | { kind: "canvas" };
  /** For coInstance and ContentDisplay: the inner scene and how it maps into `box`. */
  inner?: { sceneId: string; toHost: Transform; uniform: boolean };
  locked?: boolean;         // objectMeta.locked, or carried (opaque) parts
}

export interface Scene {
  id: string;               // screen or content UniqueId, or CO definition id
  kind: "screen" | "content" | "coDefinition";
  size: { width: number; height: number };   // root box, SDU
  toPanel: Transform;       // SDU -> panel px (identity for Canvas/Grid roots)
  grid: Grid;
  nodes: Map<string, SceneNode>;
  roots: string[];
  hash: string;             // of the flat parts + meta it was built from
}

export interface Unit {    // what moves as one
  id: string; members: string[]; box: Box;
  kind: "composite" | "card" | "coInstance" | "part";
  cellBound?: Box;          // a Grid-cell leaf may not leave its cell
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
  scene: { id: string; size: Box; panel: string; grid: Grid };
  units: { id: string; kind: Unit["kind"]; type: string; parent?: string; box: Box; row?: string; column?: string }[];
  rows: { id: string; edge: Edge; at: number; units: string[]; gaps: number[] }[];
  columns: { id: string; edge: Edge; at: number; units: string[]; gaps: number[] }[];
  nearMisses: { a: string; b: string; edge: Edge; by: number }[];
  violations: ({ kind: "overlap"; a: string; b: string; w: number; h: number } | { kind: "outOfBounds" | "offGrid"; unit: string })[];
  room: string;             // regions.ts roomReport
}

export interface Plan {
  moves: { unit: string; ids: string[]; from: Box; to: Box }[];
  ops: import("@/core/ops").Op[];      // moveObject/resizeObject per unit, exact numbers, made by code
  conflict?: { constraints: string[]; reason: string };
}

export interface Verification {
  ok: boolean;
  checks: { name: string; ok: boolean; before?: number; after?: number; ids?: string[] }[];
}
```

### 2.10 What changes, in which files

| File | Change |
|---|---|
| `lib/layout/{types,scene,facts,solve,verify}.ts` | new. Pure. Built from `containers.ts`, `co-look.ts`, `tidy.ts` `moveSetOf`, `critic/geometry.ts` |
| `lib/ote/containers.ts` | `mergeTree` writes siblings in the flat list's order within each container (S5-01); exports `slot` boxes for `cellBound` |
| `lib/ote/tidy.ts` | `planTidy` becomes `solve({noOverlap, keepRows, snap})`; `overlapsOn`/`moveSetOf` stay as the unit builder |
| `core/ops/ops.ts`, `apply.ts` | add `arrange`; `alignObjects`/`tidyLayout` delegate; `moveObject dx` still exact |
| `store/edits.ts`, `store/slices/objects.ts` | `align`/`spread` go through units and the solver (S5-02) |
| `components/canvas/ScreenRenderer.tsx` | snap position, not delta; doc fix at line 110 |
| `components/canvas/ScreenBoard.tsx`, `CanvasPane.tsx` | one `boardLayout(screens)` with per-frame sizes (S5-03) |
| `components/canvas/CanvasToolbar.tsx` | Align/Distribute through the solver; add "Tidy screen" with preview |
| `components/inspector/LayersPanel.tsx` | phase 5: show the scene tree (containers, CO instances, composites) |
| `lib/ai/converse.ts` | `layoutFacts` in the volatile context in place of the overlap sentences; prompt section "Arranging" |
| `lib/agent/tools.ts`, `agent/project.ts` | `layout_facts`, `layout_solve`; `screen_objects` adds the SDU box beside the local one |
| `lib/mcp/read.ts` | `get_layout` read tool |
| `lib/critic/geometry.ts` | `geom.nearMiss` over all parts incl. text (edges and centres), replacing the 3-cluster rule |
| `lib/ote/layout.ts` | 4 px insets; panels below 640 wide get a compact chrome (S5-04: 8 parts outside 320x240) |
| `store/types.ts` | `gridSize` default 4 for new projects; per-screen detected unit stored in `objectMeta`-like `screenMeta` |

### 2.11 Risks

| Risk | Mitigation |
|---|---|
| A wrong transform moves an engineer's Grid leaf out of its cell on export | `cellBound` is a hard constraint; the verify step checks it. `mergeTree` already pins inside the cell (`containers.ts:326-349`); the S5 measurement re-run gates each phase |
| ViewBox screens: the model reasons in panel px, the file holds SDU | facts print SDU *and* the panel scale once per screen; ops are made by code in SDU only |
| Fractional content screens get rounded and drift | never snap untouched parts; keep fractional values as read |
| Solver output fights an engineer's deliberate near-miss (a 2 px offset on purpose) | near-miss fixes only when asked (a `snap`/`align` in scope); `keep` and locked parts are pins |
| Facts get too long for big screens (114 parts measured) | units, not parts (composites collapse); cap at 60 units per scope, region by region; rows and columns are short lists |
| Collab: a solve on a stale screen | the solve carries the scene `hash`; `apply` refuses on mismatch, as proposals already do for snapshots (`lib/collab/proposal.ts`) |
| The model still sends numbers | `arrange` refuses coordinates; `moveObject` keeps `dx` only for "move 150 px right" |
| OTE renders a ViewBox differently from our letterbox assumption | verify one ViewBox screen in the licensed editor (open question 3) |

### 2.12 Phased plan, with tests per phase

| Phase | Size | Builds | Tests (web/tests) |
|---|---|---|---|
| 0. Bugs that need no design | S | S5-01 sibling order in `mergeTree`; S5-03 one `boardLayout`; snap position not delta; S5-04 small-panel chrome | the four S5 audit tests move into web/tests and pass; a snap test on the pure position function |
| 1. Scene and facts, read-only | M | `lib/layout/scene.ts`, `facts.ts`; critic `geom.nearMiss` | scene of every tracked fixture plus a synthetic Grid/CO/content project: every leaf's SDU box equals `layoutTree`'s; transforms round-trip (SDU to panel to SDU within 1e-9); facts deterministic (same input, same text, snapshot); near-miss counts match `s5-measure.mts` on ours |
| 2. Solver plus verify | M | `solve.ts`, `verify.ts`; units from `moveSetOf` | property tests: random align/distribute/noOverlap sets on generated screens leave residual 0; conflicting sets return the cycle; untouched units bit-identical; replay the perturbation trial: stuck 0 of 38 generated, moved units aligned on x and y in >= 90% |
| 3. Wire it in | M | `arrange` op; `alignObjects`/`tidyLayout` as aliases; toolbar through units (S5-02); agent `layout_facts`/`layout_solve`; MCP `get_layout` | S5-02 test passes; `tests/tidy.test.ts` still green; agent tool tests against the workspace (no `json_set` path); the three Part 4 prompts ("align the start and stop buttons", "these labels overlap, fix it", "make this screen tidy") replayed on fixtures with a recorded model turn: geometry measured, not judged |
| 4. Grid unit | S | detection; 4 px default; layout insets on 4 | detection on ours = 4; on generated after the change = 4 with >= 95% coverage; untouched-parts invariance on the engineer files (re-run `s5-measure.mts`: unit, offGrid unchanged for parts not moved) |
| 5. Tree in the UI | L | Layers shows the scene tree; board row of CO definitions; content screens nested under their displays | render tests on the pure tree builder; the CO row never writes to a definition |

### 2.13 Open questions for Shaurya

1. **Grid default.** May new projects default to a 4 px grid (and generated layouts move to 4 px insets), or is
   8 px a customer standard? The measured engineer screens sit mostly on 2 px.
2. **Engineer near-misses.** Should a "tidy" ever touch an engineer's existing parts that were not named? This
   design says no: only what is in scope moves.
3. **ViewBox scaling.** Can one ViewBox-rooted screen be opened in OTE 4.4 to confirm that a 1024x600 ViewBox
   on a 1280x800 target letterboxes (uniform scale), as `co-look.ts` assumes for COs? The facts print a panel
   scale on that assumption.
4. **Panel list.** HMIST6600 at 1280x800 is the target of all 4 engineer files but is not in
   `lib/backend/panels.ts`. Add it from DeviceInfo?
5. **CO definitions on the project canvas.** May they be edited there (the `.co` writer), or shown read-only
   in phase 5?
6. **MCP.** Is a new `get_layout` read tool acceptable on the connector, or should facts ride inside
   `get_screens`? The wire format of existing tools does not change either way.
7. **Overlap disjunction.** The solver separates along the axis of least penetration. Is "below first" (the
   current `tidy.ts` order) a rule engineers expect, or should rows be preferred?
