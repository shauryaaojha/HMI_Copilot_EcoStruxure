# HMI Copilot — implementation plan

How the product in [`ui-reference/`](ui-reference/) gets built, in the order it should
be built, with the decisions already made.

Target: **Next.js full stack**, one repo, one language, deployed as one app.
Reference implementation: [`../tools/`](../tools/) — the Python generator that already
produces a project OTE opens. Phase 1 is a port of it, not a new invention.

---

## The one rule

> **The canvas may only render what the packager can emit.**

The whole pitch is "one model, two renderers — the preview cannot lie about the
output". The moment the canvas draws something no `.eote` can contain, the demo
becomes a mockup and a judge who opens the exported file will find it out.

So every visual in the UI reference has to be traced back to a real OTE part before it
is built. That trace is done — see the next section.

---

## What the UI reference needs, and what OTE actually has

| Mockup element | Real part | Status |
|---|---|---|
| Status lamp (Running / Stopped) | `Lamp`, `N-StateLamp` | proven in `tools/make_project.py` |
| START / STOP buttons | `Switch`, `ToggleSwitch` | shape captured in `reference/part_examples.json` |
| Numeric readouts with units | `NumericDisplay` + `TextBox` | proven |
| Bargraph with tick labels | `BarScale` | shape captured |
| Flow trend chart | `TrendGraph`, `BlockTrend` | shape captured |
| Alarm list / history | `AlarmSummary` | proven |
| Panel cards, banner | `Rectangle`, `TextBox`, `GroupObject` | proven |
| **The 3D pump graphic** | `Path` / `ClipArt` | **see below** |

### The graphic object library — the find that makes the canvas honest

The product ships **475 graphic objects** at
`Buildtime\PropertyDefinitions\ScreenDesign\GraphicObjects\`, organised as
`00-LayoutObjects`, `01-Parts`, `02-Shapes`, `03-Icons`, `04-Cliparts` — with icon
categories for Pumps, Tanks, Valves, Pipes, Fans, Air Compressors, Mixing, Arrows and
more.

Each `.path` file is JSON:

```json
{
  "Name": "Pump01",
  "Commands": "MLLLLLLLLLLzMLLLLz…",
  "Points": "0,2502,166,2502,620,2502,…"
}
```

`Commands` is an SVG-style command string (`M` `L` `C` `z`); `Points` is the flat
coordinate list those commands consume. Zipping the two produces an SVG `d` attribute
directly.

That gives the product three things at once:

1. The generated project uses **Schneider's own symbol library**, not clip art we drew.
2. The browser canvas renders the **identical geometry** — same commands, same points —
   so the preview stays truthful.
3. Equipment inference gains a target: "this cluster of tags is a pump" now resolves to
   a specific symbol in a specific category.

Building the library index is Phase 2b and it is worth doing early — it is the single
biggest visual upgrade in the product and it costs one parser.

---

## Phases

Each phase ends in something demonstrable. Phases 0–2 and 7 are the critical path: they
prove the browser can do what `tools/` already does. Everything after that is product.

### Phase 0 — Foundation

Scaffold, design tokens, application shell.

- Next.js App Router + TypeScript + Tailwind v4, theme tokens read off the UI reference
  (chrome `#0F1419` / `#151B23`, panel `#1C2430`, Schneider green `#3DCD58`, alarm
  `#F04438`)
- UI primitives: `Button`, `Input`, `Select`, `Tabs`, `Panel`, `Badge`, `Toggle`,
  `Field`
- Shell: `TopBar`, `NavRail`, resizable three-pane layout, `BuildTimeline` dock
- Light / dark toggle — the mockups show both, and the HMI screen itself is rendered
  from the project palette either way

**Done when:** the workspace shell renders empty at 1920 and at 1440, panes resize,
nothing is hardcoded that a project would supply.

### Phase 1 — The OTE model layer  ← the moat

A straight port of `tools/make_project.py` to TypeScript. No new format work.

| Module | Responsibility | Ported from |
|---|---|---|
| `lib/ote/schema.ts` | zod schemas for `Screen`, `ViewBox` and each part | `PropertyDefinitions/*.propDef` |
| `lib/ote/palette.ts` | ColorSet 4 "Green-Simple" index → hex | `tools/render_screen.py` |
| `lib/ote/parts.ts` | the part catalogue and factory functions | `reference/part_examples.json` |
| `lib/ote/bindings.ts` | `Sources` → `Bindings` → `Targets` graph builder | `tools/make_project.py` |
| `lib/ote/alarms.ts` | `AlarmGroup` / `Alarm` rows, bit and level | `tools/make_project.py` |
| `lib/ote/packager.ts` | jszip + sql.js → `.eote` | `tools/make_project.py` |

Two traps carried over from the Python:

- **ZIP entries use backslash separators.** Python's `zipfile` silently rewrites them;
  verify jszip's behaviour against the raw bytes (`blob.includes("Screens\\")`), never
  against the library's own name list.
- **Quote every SQL column.** `Order` and `Value` are keywords, and SQLite returns an
  unknown double-quoted identifier as a *string literal* rather than erroring — that is
  how the deck once printed the word "SetPoint" in every setpoint cell.

**Done when:** a Vitest test packs a project from the same `TAGS`/`ALARMS` as the Python
version, and the resulting file **opens in OTE 4.4**. Nothing downstream is worth
building until this passes.

### Phase 2 — The canvas  ← the hero

`Screen.dat` JSON → inline SVG, one DOM node per object carrying its `UniqueId`.

- `ScreenRenderer` walks the object tree; `parts/` has one component per part type
- absolute `Location` + `Width`/`Height` inside a `ViewBox` maps 1:1 to SVG
- selection handles, hover highlight, click-to-inspect — all resolved by `UniqueId`
  straight back to the JSON node
- zoom / pan / fit, grid and snap

**Done when:** loading `demo_project/HMICopilot_PumpStation.eote` renders pixel-comparable
to `assets/screen_design.png`, which `tools/render_screen.py` produced from the same
JSON. That comparison *is* the "two renderers" claim, so make it a test.

### Phase 2b — The graphic object library

- `scripts/index-graphics.mjs` walks `GraphicObjects/**/*.path`, zips `Commands` with
  `Points` into an SVG `d`, and writes a JSON index with category, name, viewBox
- `<GraphicObject>` renders one; the Library panel browses them by category
- the packager emits the matching `Path` / `ClipArt` part

**Done when:** a pump symbol placed from the library appears on the canvas and survives
a round trip through export and re-open in OTE.

### Phase 3 — Tags and project state

- upload `.csv` / `.txt` / `.xlsx`, parse with SheetJS, normalise to
  `{name, dataType, address, scanRate, comment}`
- the Tags screen with the summary panel from reference screen 3 (total / BOOL / INT /
  REAL / STRING)
- zustand + immer store, undo/redo over the JSON tree, autosave

**Done when:** a 1,200-tag export loads, is typed correctly, and the summary matches.

### Phase 4 — Generation pipeline and streaming

- `POST /api/generate` returns SSE; the eight pipeline steps each emit
  `step` / `object` / `binding` / `log` / `done` events
- Claude `claude-opus-5` via `@anthropic-ai/sdk`, `messages.parse()` with
  `zodOutputFormat` against the Phase 1 schemas, so an invented property cannot survive
- equipment inference, part selection, layout planning, binding resolution
- `BuildTimeline` consumes the stream; the canvas appends each object as it lands

**Done when:** typing the pump-station intent makes the screen assemble itself object by
object, with the timeline reading in engineering language, not "Thinking…".

### Phase 5 — Inspector and editing

- property groups per part type, generated from the Phase 1 schemas
- edits write back into the store and re-render immediately
- the binding editor: source tag picker, target property, live type check

**Done when:** every field in reference screens 1, 5 and 6 edits a real property.

### Phase 6 — Binding map and validation

- `BindingMap` from the real `Sources`/`Targets` graph — port
  `tools/make_binding_map.py`, add filters (All / Bound / Unbound / Errors) and
  auto-bind
- validation rules: naming conventions (reserved words, leading digits, spaces),
  binding integrity, type mismatch, completeness, standards conformance
- results grouped Errors / Warnings / Info, each clickable back to its object

**Done when:** deleting a binding turns a row amber in the map and raises an error in
validation, both linking to the same object.

### Phase 7 — Export  ← the demo's climax

- `POST /api/export` with `export const runtime = 'nodejs'` — sql.js is WASM, so no
  native module, but Edge cannot serve it
- returns the `.eote` plus the HTML validation report
- the export dialog from reference screen 9

**Done when:** a project generated in the browser downloads and opens in OTE. This is
the moment the whole pitch rests on — schedule it early, not last.

### Phase 8 — Simulation

- a sim engine drives tag values on a tick; lamps swap `Off`/`On`, numerics move,
  alarms cross their setpoints and appear in the summary
- the `Simulate` button and Live / Static toggle

**Done when:** the canvas behaves like `assets/screen_live.png` without any hardware.

### Phase 9 — Supporting screens

Landing, Projects, Templates, Library, Standards, History, Settings — reference screens
1, 2, 4, 5, 10, 11, 12.

### Phase 10 — Rehearsal

Seed data, the ninety-second demo path, the fallback project, and a run-through on the
machine that will actually present.

---

## Build order under time pressure

```
0 ─▶ 1 ─▶ 2 ─▶ 7        prove the loop: browser builds a file OTE opens
        └▶ 2b           the symbol library — cheap, and it carries the visuals
             ▼
        3 ─▶ 4          make it AI-driven and make the work visible
             ▼
        5 ─▶ 6 ─▶ 8     control, trust, behaviour
             ▼
             9 ─▶ 10    surface area and polish
```

If time runs out, stop after Phase 4 and demo from the Phase 7 export. A working
generate → watch → export loop beats a complete but hollow surface.

---

## Risks

| Risk | Handling |
|---|---|
| jszip normalises backslash entry names the way Python's `zipfile` does | Verify against raw bytes in a Phase 1 test, before anything is built on top |
| sql.js WASM not served correctly by Next | Pin the asset path, `runtime = 'nodejs'`, covered by the Phase 1 test |
| The canvas drifts ahead of the packager | The one rule, enforced by the Phase 2 render-comparison test |
| Model invents a property or a part type | `zodOutputFormat` against the `.propDef` schemas; unknown types fail closed |
| Skeleton `.db` files are Schneider's, not ours | `scripts/extract-skeleton.mjs` pulls them from the local install at setup; `web/src/lib/ote/skeleton/` is gitignored and never redistributed |
| Equipment inference on messy tag names | It is a proposal — the engineer confirms the equipment list before generation |

---

## Not in scope

Device driver configuration, PLC logic, panel download, safety-instrumented functions.
Generated variables stay internal, which keeps the demo hardware-free.
