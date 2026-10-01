# Phase 5 — one Screen Program, one panel, and the bar

*Written 2 October 2026. Start: an outside review of the architecture (an LLM
read of the repository at commit 6913654), checked claim by claim against the
code before anything was changed. This records what the check found, what was
built from it and in which commit, and what was left on purpose.*

---

## 0 · The review, checked

| Claim | Verdict | Evidence |
|---|---|---|
| `/api/generate` has one model decision: the screen plan | **Right** | `planScreen` was the only model call |
| The planner and `architectPrograms` are split; the request never reaches the process views | **Right** | the two were laid out side by side; headlines came from the class table only |
| L3 had no semantics | **Right** | `ScreenProgram.level` was `1 \| 2`; `layout.ts` drew level 3 as level 2 |
| The ontology is hard-coded | Right, **not changed** (§6) | `infer.ts`, `plant/classes.ts` |
| Default ranges are assumptions | Right, but **not silent** | they were already listed as assumptions; the review missed that the *normal band* was invented even for export ranges (§1) |
| Alarms are a proposal, not configuration | **Right** | and the 85/95 thresholds ignored the range's units (§1) |
| Unknown variable rows are lost when variables change | **Wrong** | `syncVariables` never touched an unmodelled row; the real gap was a duplicate *name* (§1) |
| Target handling is split | **Right**, and worse | a new project was "HMIGTO6310 at 1024x600", a panel that does not exist (§2) |
| No semantic critic | **Half right** | `critic/coverage.ts` existed; the headline check ran only in a test (§4) |
| Undo is snapshots, persistence is localStorage | Right, **not changed** (§6) | |
| The simulator is synthetic | **Right** | the badge said "Live" (§1) |
| The bar is "research complete" | **Wrong** | the findings said the range mapping was unknown; answered from the product's help (§5) |

What the review missed and the check found:

- the L1 KPI overview was built and then filtered out before layout;
- `sections: "status" | "process"` were never read, only `"alarms"`;
- faceplate cards ignored the class headline order, so a card and the process
  view could lead with different readings for the same pump;
- **on the 1024x600 demo panel a unit overview with an alarm banner holds one row
  of three cards, the plan put six on it, and three units were laid out below
  the bottom edge** — silently, on every multi-unit project;
- `graphics-index.json` is gitignored, so symbols exist only on a machine with
  OTE installed (unchanged: it is derived from Schneider's installation).

---

## 1 · Small claims made true — 7299a03, e961c76

- **Normal band.** `Range.band` is `"stated" | "assumed"`; both the export and
  the class default say assumed, the Plant Model lists the export ranges whose
  band nobody gave, the Plant page marks them, and setting lo/hi by hand states it.
- **Alarms** are proposed at 85% and 95% of the reading's range, in its units,
  and the log, the step and the landing copy say *proposed*, naming what is not
  decided: deadband, delay, rationalised priority.
- **A carried name** (an array or structure the reader could not model) is bound
  to, never duplicated.
- **The simulator** says "Simulated", and its button says what it exercises.

## 2 · One panel — e961c76

The client sends the project's target; the route falls back to the skeleton's
`Target.dat`; the pipeline plans, lays out and validates against that one
object. `gridFor` narrows the grid to the panel, `capacityOf` says how many
units a level holds on it, the planner is told those limits, and `fitToLimits`
splits any screen that holds more, whatever wrote the plan. A new project
starts on the default profile and moves to the skeleton's panel while untouched.

## 3 · One Screen Program — e961c76, 4b3b307

Every screen is a `ScreenProgram`, compiled by `compileProgram` on one placer:

- planned screens through `programOf` — faceplates, sections, readings, level;
- the architect's process views and overview KPIs, which lead with the readings
  the request named (`architectPrograms(plant, { readings })`);
- the KPIs on the planned overview, its overflow tiles on a continuation page;
  their own L1 only when the plan made none.

The planner returns `readings` (exact tags, re-checked against the inventory);
the offline path reads them from the sentence (`readingsFromIntent`). One order,
`orderReadings`, chooses a reading everywhere: asked-for, then class, then declared.

**Level 3** is a detail panel per unit: state lamps, commands (the momentary
Switch for `_START`/`_STOP`, a ToggleSwitch for a single `_CMD`), mode/step,
every reading on its own indicator, a trend when they fit. A setpoint is shown,
not entered: a numeric entry part is not modelled yet.

## 4 · Semantic validation — 4b3b307

`lib/validation/semantic.ts`, on every validation, against the Plant Model the
engineer corrected (sent by the client) or the one derived from the tags:
`semantic.metric`, `semantic.wrongEquipment`, `semantic.missingState`,
`semantic.missingCommand` (once per project), and `model.classHeadline` for
equipment with a reading on screen. None of the warnings fire on the generated
samples.

## 5 · The bar — 3c9242c

The product's help (`Help/en/featureguide/property/Properties_(Rectangle).htm`,
`bar_metergraph/fs01.htm`): FillLevel takes 0-100, and a bar graph is a Rectangle
bound **through a Scale converter**. The corpus gave the row shapes.

- `AnalogIndicator` draws a FillLevel Rectangle with the normal band as a frame
  on it; a short box keeps the bar and drops the scale.
- `lib/ote/converters.ts` writes one `Scale` converter per range into
  `Converters.db` (skeleton's or the opened file's, only when missing) and the
  binding names it by `ConverterId`/`ConverterName`, Mode 1.
- The reader models a Scale-converter binding as a bar and writes it back as
  itself; the converter rides on the store's binding through generation, export,
  import and screen import; the simulator applies it; the canvas draws the fill.

**Still to confirm in the product:** `FromMin` is written explicitly (the corpus
omits it at 0). `npm run build:bars` writes `demo_project/HMICopilot_Bars.eote`;
open it in OTE 4.4 and check one converter (OPEN_TEST.md, "Bars").

---

## 6 · Left on purpose

| Item | Why not now |
|---|---|
| Declarative equipment-class registry | Right direction; it is a data migration of `infer.ts` + `classes.ts` + `units.ts` with no behaviour change, worth doing when `.xvm` DDT ingest lands and classes come from types instead of names |
| Event-sourced op log | Undo works; the semantic ops in `ops.ts` are already the log's vocabulary. Do it with server persistence, not before |
| Server project persistence | MongoDB exists for opened files and the skeleton; projects stay local until there is a multi-user need |
| Alarm rationalisation UI | Needs the engineer's decisions (priority by consequence, deadband, delay) as fields first; the proposal is now labelled as one |
| Numeric entry part (setpoints) | Not captured from a real file yet; drawing an editable-looking box would be the untruth this project avoids |
| Parameterised reusable screens, native `.co` composites | Phase-3 roadmap items; unchanged by this review |
