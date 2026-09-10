# HMI Copilot

**From PLC tags to a ready-to-open EcoStruxure project.**

A PLC tag export plus one sentence of plain English becomes a complete, validated
**EcoStruxure Operator Terminal Expert 4.4** project — screens drawn, tags declared,
alarms configured, bindings wired — while the engineer watches every object being
generated and approves it before export.

Built for the Schneider Electric HMI hackathon, Problem Statement 3.

---

## This is built, not proposed

`demo_project/HMICopilot_PumpStation.eote` was written from scratch by
`tools/make_project.py` and **opens in EcoStruxure Operator Terminal Expert**. It was
never saved by the product.

| | |
|---|---|
| 19 | parts placed on the screen |
| 7 | typed tags in `Variables.db` |
| 5 | alarms in `Alarm.db` |
| 11 | bindings wired |
| 0 | objects placed by hand |

Open it with **File ▸ Open Project**. See [`demo_project/OPEN_TEST.md`](demo_project/OPEN_TEST.md).

---

## Repository layout

```
docs/
  SOLUTION.md           the full solution statement
  BUILD_PLAN.md         implementation plan and build phases for the product
  FRONTEND_PROMPTS.md   paste-ready prompts for the UI screens
  ui-reference/         the agreed UI design, 6 reference renders
web/                    the product - Next.js full stack (see docs/BUILD_PLAN.md)
tools/                  the proven generator core, in Python
  make_project.py       writes a complete .eote from a tag list
  render_screen.py      renders a project's Screen.dat to PNG
  make_binding_map.py   renders a project's binding graph
  make_demo_co.py       compound-object (.co) packager, secondary output
  make_deck.py          builds the presentation from the generated project
  fill_deck.py          fills the single-slide submission poster
demo_project/           generated .eote files - the proof
demo_objects/           generated .co compound objects
reference/              one real example of each of the 50 OTE part types
assets/                 diagrams and rendered screens used in the deck
```

`tools/` is the reference implementation: every format detail was established there
first, against a real installation. `web/` ports that same logic to TypeScript so it
can run in the product.

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

---

## Running the generator

```bash
python tools/make_project.py demo_project
python tools/render_screen.py demo_project/HMICopilot_PumpStation.eote assets
python tools/make_binding_map.py
```

Requires an EcoStruxure Operator Terminal Expert 4.4 installation for the project
skeleton, plus `pillow` and `python-pptx` for the renderers and the deck.
