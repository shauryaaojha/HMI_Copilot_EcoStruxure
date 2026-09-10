# HMI Copilot

**From PLC tags to a ready-to-open EcoStruxure project.**

A PLC tag export plus one sentence of plain English becomes a complete, validated
**EcoStruxure Operator Terminal Expert 4.4** project — screens drawn, tags declared,
alarms configured, bindings wired — while the engineer watches every object being
generated and approves it before export.

Built for the Schneider Electric HMI hackathon, Problem Statement 3.

---

## This is built, not proposed

Two `.eote` files in `demo_project/` were written from scratch and **open in
EcoStruxure Operator Terminal Expert 4.4**. Neither was ever saved by the product.

| File | Written by | Status |
|---|---|---|
| `HMICopilot_PumpStation.eote` | `tools/make_project.py` — the Python reference | opens in OTE 4.4 |
| `HMICopilot_TS.eote` | `web/src/lib/ote/packager.ts` — the browser path | opens in OTE 4.4 |

| | |
|---|---|
| 19 | parts placed on the screen |
| 7 | typed tags in `Variables.db` |
| 5 | alarms in `Alarm.db` |
| 11 | bindings wired |
| 0 | objects placed by hand |

Open either with **File ▸ Open Project**. See
[`demo_project/OPEN_TEST.md`](demo_project/OPEN_TEST.md).

---

## Status

Phases are from [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md); the two columns are the
parallel workstreams described in [`docs/WORKSTREAMS.md`](docs/WORKSTREAMS.md) —
**FORMAT** owns everything touching the `.eote`, **SURFACE** owns everything the
engineer sees.

| Phase | | FORMAT | SURFACE |
|---|---|---|---|
| **0** | Foundation — tokens, primitives, shell | — | ✅ done |
| **1** | The OTE model layer *(the moat)* | ✅ **verified in OTE 4.4** | — |
| **2** | The canvas *(the hero)* | — | ✅ done |
| **2b** | Graphic object library | ✅ done | ✅ done |
| **3** | Tags and project state | ✅ done | ✅ done |
| **4** | Generation pipeline and streaming | ✅ done | ✅ done |
| **5** | Inspector and editing | — | ✅ done |
| **6** | Binding map and validation | ✅ done | ✅ done |
| **7** | Export *(the climax)* | ✅ done | ✅ done |
| **8** | Simulation | — | ✅ done |
| **9** | Supporting screens | — | ✅ done |
| **10** | Rehearsal | — | 🟡 script done, live run-through pending |

**337 tests.** 324 of them run anywhere; the other 13 — the Phase 1 packager gate and
the symbol round-trip — need a local EcoStruxure installation to extract a skeleton
from, and skip without one. So the number a run prints depends on the machine: 324 on
a Mac, 337 on the Windows laptop. Measured with the app running, since the Phase 10
rehearsal calls the routes.

```bash
cd web && npm test
```

### What the partials mean

- **2b — done.** Every symbol keeps `Commands` and `Points` beside the derived
  `d`, a test asserts the two can never drift, and a `Path` part round-trips
  through the packager with its geometry byte-identical. The Library places one
  via `pathPart()`, so what lands on the canvas is what an export contains.
  `npm run build:symbols` writes a project with Pump01, Tank01, Valve01 and
  Fan01 in it — **still to be opened in OTE.**
- **4 — done.** Equipment inference is a parse of the tag names and runs
  offline, so the screen builds with no key at all — the timeline says so rather
  than passing the fallback off as the model. With a key in `web/.env.local`,
  **Gemini** (checked first, the free tier) or **Claude** reads the engineer's
  sentence and decides what the screen shows. One model call per generation:
  ~650 input tokens for the demo tag list, ~14K for a 1,248-tag export.
- **7 — done.** `POST /api/export/report` renders a standalone HTML sign-off
  document — no stylesheet, no font host, no script, because a commissioning
  laptop has no internet. The export screen offers all three files.
- **10 — nobody has walked the script on the presenting machine.**
  `web/tests/demo-path.test.ts` checks the data, the routes and the engine behind
  every beat, but it cannot check that a button is where the script says it is.

---

## The one rule

> **The canvas may only render what the packager can emit.**

The pitch is "one model, two renderers — the preview cannot lie about the output".
The moment the canvas draws something no `.eote` can contain, the demo becomes a
mockup and a judge who opens the exported file finds out.

It is enforced by `tsc`, not by discipline: `ScreenRenderer` switches exhaustively
over the part union in `schema.ts`, so adding a part to the schema stops the canvas
compiling until it can draw it. `web/tests/canvas.test.ts` holds the other half —
it renders the fixture and checks the result against the rules
`tools/render_screen.py` used to draw `assets/screen_design.png`, restated
independently so the two renderers cannot drift together and still pass.

The corollary is visible in the product: **the theme toggle themes the application
and never the HMI screen**, whose colours are palette indices resolved out of the
project's own colour set. A test asserts the rendered screen contains no application
token and only palette hex.

---

## Running it

```bash
cd web
npm install
npm run dev            # http://localhost:3000
```

The canvas renders a real pump-station screen immediately, from `src/fixtures/` —
our own output, lifted out of `demo_project/HMICopilot_PumpStation.eote`. No
EcoStruxure installation needed.

Two setup scripts read a local installation and are expected to fail without one.
Their output is gitignored — those are Schneider's files, extracted per machine and
never redistributed.

```bash
npm run setup:skeleton    # pulls the project skeleton out of the installation
npm run index:graphics    # indexes the 474 shipped graphic objects
```

Without the skeleton, `POST /api/export` answers **503** with the setup instruction.
That is a licensing boundary, not a failure, and the export screen says so.

### The demo

[`docs/DEMO.md`](docs/DEMO.md) is the ninety-second path: eleven beats with timings,
what to do and what to say, and a fallback for each one that can fail. Rehearse it
with the app running:

```bash
npm run dev
npm test               # the demo-path line must read 24 tests, not 24 with 15 skipped
```

---

## Repository layout

```
docs/
  SOLUTION.md           the full solution statement
  BUILD_PLAN.md         the eleven phases, and why they are ordered that way
  WORKSTREAMS.md        the two parallel workstreams, and who owns which files
  DEMO.md               the ninety-second demo path, with fallbacks
  PRODUCTION.md         what it would take to put this in front of real engineers
  FRONTEND_PROMPTS.md   paste-ready prompts for the UI screens
  ui-reference/         the agreed UI design, 6 reference renders
web/                    the product — Next.js full stack
  src/lib/ote/          the format layer: a TypeScript port of tools/make_project.py
  src/lib/sim/          the simulation engine — pure client, no format knowledge
  src/components/       canvas, inspector, binding map, timeline, primitives
  src/app/api/          generate (SSE), export, tags/parse, validate
  public/demo/          six sample tag exports; see its README for what each covers
  tests/                including the Phase 1 packager gate and the demo rehearsal
tools/                  the proven generator core, in Python
  make_project.py       writes a complete .eote from a tag list
  render_screen.py      renders a project's Screen.dat to PNG
  make_binding_map.py   renders a project's binding graph
  make_demo_co.py       compound-object (.co) packager, secondary output
  make_deck.py          builds the presentation from the generated project
  fill_deck.py          fills the single-slide submission poster
demo_project/           generated .eote files — the proof
demo_objects/           generated .co compound objects
reference/              one real example of each of the 50 OTE part types
assets/                 diagrams and rendered screens used in the deck
```

`tools/` is the reference implementation: every format detail was established there
first, against a real installation. `web/src/lib/ote/` ports that same logic to
TypeScript so it runs in the browser, and `web/tests/packager.test.ts` diffs the two
structurally.

---

## How the format works

`.eote` is a ZIP of plain JSON and plain SQLite, with **backslash** entry separators.
No signature, no encryption.

```
<project>.eote
 ├─ Project.dat, Target.dat      JSON    identity, panel model, resolution
 ├─ Variables.db                 SQLite  the tags
 ├─ Alarm.db                     SQLite  alarm groups and alarms
 ├─ Bindings.dat                 JSON    Sources → Bindings → Targets
 └─ Screens\<guid>\Screen.dat    JSON    the object tree
```

Everything we emit was extracted from the sample projects the product ships at
`Buildtime\BuildtimeData\ProjectTemplates`, and is constrained by the machine-readable
schemas in `Buildtime\PropertyDefinitions\`. Nothing was guessed, and nothing here
bypasses a licence.

Two traps, both paid for once already:

1. **ZIP entry names use backslashes.** Python's `zipfile` silently rewrites them, so
   verify against the raw bytes (`text.includes("Screens\\")`), never against the
   library's own name list.
2. **Quote every SQL column.** `Order` and `Value` are keywords, and SQLite returns an
   unknown double-quoted identifier as a *string literal* rather than erroring — which
   is how a deck once printed the word "SetPoint" in every setpoint cell.

---

## Running the generator

```bash
python tools/make_project.py demo_project
python tools/render_screen.py demo_project/HMICopilot_PumpStation.eote assets
python tools/make_binding_map.py
```

Requires an EcoStruxure Operator Terminal Expert 4.4 installation for the project
skeleton, plus `pillow` and `python-pptx` for the renderers and the deck.
