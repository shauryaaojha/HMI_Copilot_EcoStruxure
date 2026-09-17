# HMI Copilot, re-engineered

*From a winning prototype to a tool a plant engineer is allowed to use. Research done
17 September 2026 against the repo at `c35962c`, the OTE 4.4 installation on this
machine, and the public record of what Siemens, Rockwell and Schneider ship today.*

---

## 0 · The six decisions, up front

Everything below argues for these. If you only read one section, read this one.

1. **The product is a standards compiler with an AI front end, not a prompt that draws
   screens.** Input is what an engineer already has: the PLC variable export (with its
   type structure), the plant hierarchy, and the company's HMI style guide. Output is a
   project that follows ISA-101 and ISA-18.2 because the generator cannot produce one
   that does not. The model reads intent, resolves ambiguity, names and explains. It
   never does geometry and never invents a part, a tag or a colour.

2. **The unit of work is the Plant Model, not the screen.** Areas, units, equipment
   instances typed by an equipment class, each class bound to a tag pattern, a
   faceplate template and a symbol. Screens, navigation, alarms and bindings are
   *derived* from the model. That is how PlantPAx, EcoStruxure Process Expert and
   every serious integrator library already works, and it is what makes 60-screen
   projects consistent.

3. **Use OTE's own structure instead of imitating it.** OTE has folders with master
   screens, header/footer, four kinds of automatic navigation, content displays for
   popups and panes, compound objects for faceplates, alarm groups, logging groups
   feeding trend graphs, security levels and an operation log. The prototype draws
   navigation chips out of rectangles. The product must emit the native constructs, or
   an engineer opening the project sees a foreigner's work.

4. **Read before write. Brownfield is the market.** A reader that carries through
   byte-for-byte everything it does not model is the largest piece of remaining work and
   the one that decides whether anyone gives the tool a second project.

5. **Local-first, air-gap capable, auditable.** A desktop application that reads the
   engineer's own licensed OTE install, keeps its own project file and audit record on
   disk, and talks to a model through one seam: Anthropic API, the customer's Bedrock or
   Foundry tenancy, an on-prem endpoint, or nothing at all. Every generation is stamped
   with what went in, which model and rule packs ran, and who approved it.

6. **Generation is one door in, never the only one.** An engineer can start from an
   export, from an existing `.eote`, from a compound-object library, from a screenshot
   of a screen they like, or from a blank screen, and can do by hand everything the
   generator does. Every generated object is an ordinary editable object. Every AI
   action has a manual equivalent and every manual action can be asked for in words.
   Nothing is locked, nothing is hidden behind "regenerate".

---

## 1 · What the real world looks like

### 1.1 How HMI projects are actually built

The engineering chain on a real project is documents first, screens last.

| Artefact | What it is | Why it matters to us |
|---|---|---|
| **P&ID** | The master process drawing: equipment, lines, instruments, loops, ISA-5.1 tag numbers | Defines *what equipment exists* and how it groups into units |
| **I/O list / tag database** | One row per signal: tag, description, signal type, range, P&ID ref, PLC address, alarm setpoints. "The source of truth that PLC code, HMI graphics and historian configuration all reference" | This *is* our input, and it carries more than names: ranges, units, addresses, setpoints |
| **FDS** (functional design spec) | The contract between owner and integrator; sequences, interlocks, modes, alarm philosophy | Where the *operator response* to each alarm is written down |
| **HMI philosophy + style guide** | 20–50 page philosophy, 100+ page style guide: exact palette, symbol library, per-level layout templates, navigation patterns, faceplate designs, alarm formats, typography | The company's rules. A generator that ignores them produces work that gets redone |
| **Issue cycles** | 30% / 60% / 90% / IFC / As-built | Screens are revised many times; a one-shot generator does not fit |
| **FAT → SAT → commissioning** | Where binding errors surface today | Our validation moves this to the desk |
| **MOC** | Any HMI change requires management of change with review | Our audit record has to be the MOC evidence |

Two facts shape the product more than any feature. **Most work is brownfield**: an
engineer is adding a unit to a 2019 station far more often than starting a plant from
nothing. And **cost is driven by point count, not screen count**: one integrator's rule of
thumb is about an hour per discrete point and ten per analog point, billed at $100–200
an hour. The saving to sell is in tag mapping, faceplate instantiation and alarm
configuration, which is exactly where the prototype's inference already lives.

### 1.2 What a production screen contains (ISA-101)

ISA-101 is not a colour scheme, it is a display architecture. The concrete, checkable
rules the product has to enforce:

- **Four levels.** L1 plant overview: every unit as a functional block, values shown
  only when abnormal, alarm summary visible, assessable in under five seconds. L2 unit
  operations: process flow, key variables in muted form, alarms within the unit. L3
  equipment detail: faceplates and control actions. L4 diagnostics and maintenance.
- **Grey is normal, colour is abnormal.** Backgrounds and process lines in muted greys;
  saturated colour reserved for alarm and deviation states; decorative colour is
  discouraged. Red for alarms requiring action, amber for approaching limits, magenta for
  manual/override/bypass, green for "running" is contested and the guide should decide.
- **By exception.** In-range values muted or hidden on overviews; out-of-range bold and
  coloured. Analog indicators (bar with normal band) over raw numbers where trend matters.
- **One way to draw a pump.** A toolkit of reusable objects enforces consistency: one
  valve, one alarm banner, one faceplate layout per equipment class.
- **Navigation is identical on every screen** and drills down L1 → L2 → L3.
- **Style guide is a document under MOC**, not tribal knowledge.

The prototype's layout engine already follows the spirit of this: header, navigation strip
and alarm banner in the same place on every screen, six units per display. What it lacks
is the toolkit (faceplates as reusable objects), the by-exception rendering, the analog
indicators, and any notion of the *customer's* palette rather than ours.

### 1.3 What OTE 4.4 actually offers (read from the installation's own help)

This is the part the hackathon did not have time to use, and it changes the design.

- **Folders and master screens.** Creating a folder creates its master screen; the
  master screen carries the **header, footer and navigation switch** for every screen in
  the folder. Up to **two folder levels** give a hierarchical structure.
- **Four navigation types**, generated automatically per folder: Left (list), Icon
  (menu grid), Slide (swipe), Blank. Screen change also by touch, script or an external
  variable bound to Screen ID.
- **Content displays and dock panels** for popups and multi-pane screens; screen types
  Canvas, Scroll Canvas, Zoom Canvas, Scroll Grid, View Box, Grid.
- **Compound objects (.co)** with exposed properties, localisation, converters and
  validations: the faceplate mechanism. Already reverse-engineered.
- **50 part types**, all captured in `reference/part_examples.json`. The ones a real
  screen needs beyond our six: N-State Lamp, Switch/ToggleSwitch, StringDisplay,
  BarScale/CircleScale (bar and meter graphs via animation + converter + scale),
  TrendGraph and BlockTrend (fed by data-logging groups), Pipe, Image, DateTimeDisplay,
  Grid/UniformGrid/StackPanel/DockPanel layout containers, GroupObject.
- **Variables** are internal or external; external ones carry a **device address** and
  belong to an equipment under a driver with an IP address. **Symbol Link** imports a
  Control Expert `.xvm` export directly.
- **Alarm groups, recipes, data-logging groups, security levels with password policy and
  auto-logout, operation log** of who did what. The help carries safety warnings the
  generator must respect: never design the HMI to perform corrective action for critical
  alarms; never depend on HMI logging for safety.
- **A per-panel maximum number of simultaneously displayed objects**; exceeding it stops
  drawing at runtime with a system error. A validation rule, per target model.
- **Scripts in Lua**, block or text mode, screen-scoped or global.
- The whole feature guide sits on disk at `Buildtime/Help/en/featureguide/`: an offline
  corpus for the "engineering mentor" use case with zero licensing risk, since it never
  leaves the engineer's machine.

### 1.4 Alarm management (ISA-18.2 / IEC 62682)

The prototype proposes an alarm per fault bit and per level tag with a severity. Real
plants are held to measurable targets:

- Annunciated alarms per operator: about 1–2 per 10 minutes manageable; 10 per 10
  minutes is a flood.
- Priority distribution roughly **80% low / 15% medium / 5% high**, no more than three
  or four priorities in use.
- Every alarm has a documented **cause, consequence, and operator action**; an alarm
  without a defined response is not an alarm.
- Rationalisation is a table the plant signs off, and it is the single most frequent
  reason an HMI gets rejected at SAT.

An "AI Alarm Configuration Generator" that does not produce a rationalisation table is
producing the problem ISA-18.2 exists to fix. This is also the highest-value place to
use a model: drafting cause/consequence/action text from the tag comment, FDS and
equipment class, for an engineer to approve.

### 1.5 Schneider's portfolio, as it stands

- **OTE** is positioned for Harmony STO7, GTO, GTU, P6 and Box/Panel PCs (HMIBMP,
  HMIBMU). Schneider's FAQ says **Harmony ST6/STM6 use Vijeo Designer**, while se.com
  product pages say OTE (Basic) supports ST6/STM6. The two disagree; it is the first
  question to ask them.
- The **Vijeo Designer → OTE migration tool is on hold**. An "AI Migration Assistant"
  aimed at that gap is attractive but depends entirely on Schneider's intent for the two
  products. Ask before building.
- **Control Expert exports `.xvm`** (XML) with DDT definitions and instances; Machine
  Expert exports a symbol configuration. Both carry *type structure*: a variable of DDT
  `PumpCtrl` with members `.Run`, `.Flt`, `.Cmd` is a pump by construction. That turns
  equipment classification from a regex over names into a parse over types, with the
  regex kept as the fallback for flat CSV exports.
- **EcoStruxure Automation Expert** and **Process Expert** are object libraries whose
  facets include HMI symbols and faceplates with alarms and trends. The Plant Model in
  §3 is deliberately the same shape, so an OTE adapter today and an EAE or Process
  Expert adapter later read the same model.

### 1.6 The competitor bar in 2026

| Vendor | What ships | HMI generation | Deployment |
|---|---|---|---|
| **Siemens** | Engineering Copilot TIA (Standard, Essential) and the newer **Eigen Engineering Agent** | "An initial basic HMI visualisation in WinCC Unified including header, navigation and settings"; JavaScript for dynamic behaviour; VB script migration; style-guide compliance checks; bulk property edits; spreadsheet-driven device config | Cloud, Siemens ID and licence required; on-prem announced, not shipped |
| **Rockwell** | FactoryTalk Design Studio with Copilot | Ladder and device configuration, explanation, troubleshooting. No HMI generation. Optix is the HMI platform | Cloud (Azure); edge small-model direction |
| **Schneider** | Industrial Copilot inside EcoStruxure Automation Expert, Azure AI Foundry; Hannover 2026: "specialized AI agents, coordinated by an orchestrator, automate routine design decisions and validate logic before deployment" | **None announced for HMI or Harmony** | Cloud or on-prem integration per Schneider |

Three conclusions. "AI makes a starting screen" is table stakes; Siemens ships it. Nobody
ships **standards-verified** generation (ISA-101 packs, ISA-18.2 rationalisation, a
sign-off record), **brownfield round-trip**, or a genuinely **offline** path. And
Schneider's own roadmap language, an orchestrator with specialised agents that validate
before deployment, is a description of the pipeline in §4 with HMI as the missing agent.

### 1.7 Constraints that pick the architecture

- **OT networks are restricted and often air-gapped.** A tool that phones a cloud model
  is a procurement fight at every site. Frontier closed models are not available
  offline; the realistic on-prem path is an open-weight model behind an
  OpenAI-compatible endpoint, or the customer's own Bedrock or Foundry tenancy on a
  connected network. The product must degrade to a deterministic generator with no
  model at all, which it already does for generation and must for conversation.
- **IEC 62443-4-1** is the secure development lifecycle Schneider's own products are
  certified against. A tool sold alongside them will be asked for the same posture:
  threat model, signed builds, no silent telemetry, dependency and patch management.
- **21 CFR Part 11** in pharma and food: every structural change to the HMI project
  needs who, what, when, and why, immutable. Our sign-off record is the seed.
- **Licensing.** Every `.eote` we write embeds Schneider's database skeleton and their
  474 graphic objects. Local-first is the only posture that does not redistribute them.
  Unchanged from `PRODUCTION.md` §1; it remains the first thing on the table.
- **Format version.** Verified against OTE 4.4 and nothing else. The writer must detect
  the installed version and refuse a format it has not been proven against.

---

## 2 · Honest audit of the prototype

**Keep, untouched.** The format layer and its two-implementation proof
(`tools/make_project.py` vs `web/src/lib/ote/packager.ts`, structurally diffed). The
one rule enforced by the compiler (`ScreenRenderer` exhaustive over the part union).
Corrections reported, never applied. Findings carrying an `objectId` so the binding map
and validation list cannot disagree. Conversational ops routed through the same store
actions as the toolbar. The standalone HTML sign-off report. The `.co` packager.

**Replace.**

| Today | Why it does not survive contact with a plant |
|---|---|
| Six part types: Rectangle, TextBox, Lamp, NumericDisplay, AlarmSummary, Path | No switch, no N-state lamp, no bar, no trend, no string display. A screen with no control and no analog indication is a mimic, not an operator display |
| Navigation drawn as rectangles with text on them | OTE generates navigation from folders and master screens. Ours is invisible to the product's own tooling and cannot be edited as navigation |
| One flat screen tree, header and alarm banner redrawn on every screen | The master screen exists precisely so header/footer are defined once per folder |
| Equipment inference by prefix regex on flat names (`PMP_`, `VLV_`) | Ignores the DDT/UDT structure that Control Expert and Machine Expert exports carry; misclassifies anything not in the prefix table; no confidence score |
| Alarms: one per fault bit and level tag, severity by kind | No priorities distribution, no cause/consequence/action, no flood check, no rationalisation table |
| All variables internal | The export cannot read a real value; the engineer still does the binding work we claim to save. No driver, no equipment, no device addresses even when the CSV carried them |
| Model asked to place objects by coordinate in conversation | Known rough after the third edit. A model should never do geometry |
| Colours are our palette indices | The customer's style guide is the palette. Ours is a default, not a rule |
| Zustand + localStorage, twenty in-memory snapshots | Nothing survives a closed tab; no audit record survives a cleared browser |
| No reader, no import of any kind | Cannot open the project it wrote, let alone the one the plant already has; cannot take a colleague's screen, a `.co` library, or a picture of the screen the customer wants copied |
| Generation is the only way in | An engineer who wants to draw one screen by hand, or fix one imported one, has no path that does not start with a tag file |
| No eval | Generation quality is "it looked right in the demo" |

The audit is not a criticism of the hackathon. Every row was the right cut for a
ninety-second demo. It is the gap between a loop that works and a tool an engineer can
be held accountable for using.

---

## 3 · What the product is

**HMI Copilot turns the three things an automation engineer already has, the PLC
variable export, the plant structure, and the company HMI standard, into a complete,
standards-verified, device-bound EcoStruxure project, with an audit record that shows
what was generated from what, and by whose approval.**

Principle: *deterministic where it can be, model where it must be, human where it
matters.*

### 3.1 The Plant Model

The product's own document. Target-independent, plain JSON, diffable in git.

```
Project
 ├─ Standard            the style guide as data: palette, fonts, faceplate layouts per
 │                      class, per-level templates, naming rules, alarm philosophy
 ├─ Library             equipment classes → { tag pattern, faceplate template, symbol,
 │                      alarm template, default trends }
 ├─ Hierarchy           Site → Area → Unit → Equipment   (ISA-88/95 shape)
 ├─ Equipment[]         instance: class, tag bindings by role, confidence, source rows
 ├─ Alarms[]            rationalisation records: tag, priority, setpoint, cause,
 │                      consequence, operator action, approved-by
 ├─ Displays[]          derived: L1/L2/L3 per hierarchy node, with overrides
 ├─ Devices[]           driver, equipment, IP, address map
 ├─ Provenance          import hashes, model id, prompts, rule pack versions, approvals
 └─ Preserved           anything read from a target file that the model does not cover
```

Screens are a *projection* of the model onto a target. Change the model and every
projection updates; edit a screen and the edit is recorded as an override on the model,
so regeneration never silently discards hand work.

### 3.2 Equipment classes are the moat

An equipment class is the thing an integrator library sells: for a **motor**, the roles
(`running`, `fault`, `available`, `start`, `stop`, `hours`, `current`, `speed`), the
faceplate layout, the symbol, the standard alarms with default priorities, the trends
worth logging. PlantPAx has about 45 of them; Process Expert's General Purpose Library
is the same idea. We ship a starting set (motor, pump, valve, on/off valve, control
valve, tank, PID loop, analog input, digital input, conveyor, heater, compressor, fan,
filter), each with a tag-pattern matcher that understands **DDT/UDT member names first,
naming-convention suffixes second**, and a confidence score. Customers add their own,
as data, and that is where the product becomes theirs.

### 3.3 Mapping to Schneider's own use-case list

| Schneider's use case | How this design covers it |
|---|---|
| AI-Assisted HMI Project Generation, AI Screen Generator | The pipeline, §4.2 |
| AI Navigation Builder | Folders, master screens and native navigation derived from the hierarchy |
| AI Tag Mapping Assistant | `.xvm`/symbol-config ingest, DDT-aware role binding, device addressing, corrections reported |
| AI Alarm Configuration Generator | Rationalisation table with ISA-18.2 checks; model drafts cause/consequence/action for approval |
| Intelligent Project Validation & QA | Rule packs: OTE format, panel limits, ISA-101, ISA-18.2, customer style guide |
| AI Project Review Assistant | Open an existing `.eote`, run the packs, explain findings against the offline help |
| AI Design Copilot | Conversation as a command layer over the Plant Model, never over coordinates; works the same on imported screens, screenshots and hand-built ones (§5.1) |
| Knowledge-Based Engineering Assistant, AI Engineering Mentor | Retrieval over the installed feature guide; answers cite the page |
| AI Script Generator | Lua, screen and global scripts, from templates per class; later phase |
| AI Migration Assistant | Vijeo Designer `.zdat` → Plant Model → OTE, only with Schneider's blessing; screenshot-to-screen recreation for anything older or third-party (§5.1) |
| HMI System Log Analyzer, failure analysis | Out of scope for the engineering tool; note as a runtime-side sibling |

---

## 4 · Target architecture

### 4.1 Deployment shape

```
┌──────────────────────────── engineer's workstation ─────────────────────────────┐
│  HMI Copilot desktop (Tauri shell around the existing Next.js UI)               │
│                                                                                 │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Ingest       │→ │ Plant Model    │→ │ Rule packs   │→ │ Target adapters   │  │
│  │ xvm/csv/xlsx │  │ + generation   │  │ + findings   │  │ OTE 4.4 r/w       │  │
│  │ eote (read)  │  │ engine         │  │              │  │ (Vijeo, EAE later)│  │
│  └──────────────┘  └───────┬────────┘  └──────────────┘  └─────────┬─────────┘  │
│                            │                                       │            │
│                     ┌──────▼──────┐                    ┌───────────▼──────────┐ │
│                     │ Model seam  │                    │ Local OTE install    │ │
│                     │ (one module)│                    │ skeleton, graphics,  │ │
│                     └──────┬──────┘                    │ help corpus, version │ │
│                            │                           └──────────────────────┘ │
│   SQLite: projects, versions, audit, eval results                               │
└────────────────────────────┼────────────────────────────────────────────────────┘
                             │
        ┌────────────────────┼─────────────────────┬───────────────────────┐
   Anthropic API      customer Bedrock /      on-prem endpoint         none:
   (connected)        Foundry tenancy         (vLLM, open-weight)      deterministic
```

- **Why desktop, not SaaS.** The skeleton and graphics never leave the machine; the
  engineer's own licence covers them. Works on the restricted network. No multi-tenant
  service to build before the licensing conversation is had. The Next.js codebase
  carries over; Tauri gives a small signed binary, a real file system, and SQLite.
- **The model seam is one module.** `lib/ai/converse.ts` and `lib/ai/pipeline.ts`
  already front Gemini and Claude. Formalise it as a provider interface with four
  implementations, and keep every call site behind it. This is the difference between
  "we support on-prem" and "we could".
- **A team server is a later, optional addition** for shared libraries and standards.
  It is not needed for one engineer to do a day's work, and building it now commits to a
  hosted posture prematurely.

### 4.2 The pipeline

Nine stages. Each is a pure function over the Plant Model with a typed event stream, so
the build timeline keeps saying "parsed 1,248 variables, 312 in 41 DDT instances", never
"thinking".

| # | Stage | Deterministic | Model assists | Output |
|---|---|---|---|---|
| 1 | **Ingest** | `.xvm` with DDTs, Machine Expert symbol config, CSV/TSV/XLSX, existing `.eote` | no | variables with type structure, addresses, corrections |
| 2 | **Structure** | group by DDT instance, then by loop number / prefix; detect naming convention | no | candidate equipment with confidence |
| 3 | **Classify** | match candidates to equipment classes by member roles | only for candidates below the confidence threshold, choosing from the class list | equipment instances |
| 4 | **Hierarchy** | from DDT nesting, tag prefixes, or an imported area/unit list | reads the engineer's sentence to name and regroup | Site → Area → Unit tree |
| 5 | **Plan** | L1 per site, L2 per unit, L3 faceplates per equipment; per-level templates from the Standard; panel object limits respected | adjusts scope to intent ("only the dosing skid") | display list |
| 6 | **Compose** | folders, master screens, native navigation, faceplate compound-object instances, by-exception indicators, trends from class defaults | no | target-independent display trees |
| 7 | **Bind** | roles → variables; external variables get device, driver, address; logging groups for trends | no | bindings, devices |
| 8 | **Rationalise** | alarms from class templates; ISA-18.2 priority distribution and flood checks | drafts cause / consequence / operator action | alarm table |
| 9 | **Validate → Emit → Record** | rule packs; OTE adapter writes; provenance stamped | explains findings on request | `.eote`, `.co`, sign-off record |

The model touches stages 3, 4, 5, 8 and 9, always with a strict schema, always choosing
from ids the deterministic stages produced, and always with the answer shown as a
proposal that the engineer accepts. That is the current design, kept, and made the rule
for every new model call.

### 4.3 The OTE adapter: read, write, preserve

- **Reader first.** Parse the ZIP, model what the Plant Model covers (screens, parts we
  understand, variables, alarms, bindings, devices, folders, master screens), and keep
  every other entry and every unknown JSON property in `Preserved`, keyed by path.
- **Round-trip test is the gate.** Open, export with no change, assert byte-identical
  entries. Open, add one screen, export, assert every untouched entry is byte-identical.
  Until this passes, the product is not allowed to write into a file it did not create.
- **Version matrix.** Read the installed version from `Version.ini`; write only formats
  in the proven set; run the conformance suite (open in OTE, headless if Schneider
  provides a CLI, manual otherwise) per release.
- **Part coverage** grows against captured examples, one part at a time, as today. The
  next twelve, in order of operator value: Switch, ToggleSwitch, N-StateLamp,
  StringDisplay, BarScale, TrendGraph, BlockTrend, Pipe, Image, DateTimeDisplay,
  GroupObject, DockPanel. Each addition extends the schema union, and `tsc` forces the
  canvas to draw it before it compiles. The one rule stands.
- **Native navigation.** Emit `ScreensFolder` + `MasterScreen` with header/footer and a
  navigation type, not rectangles. The engineer opens the project and sees the same
  tree they would have built by hand.

### 4.4 The AI layer

Concrete choices, from the current Claude platform reference.

- **Model.** `claude-opus-5` for intent reading, classification of ambiguous
  candidates, alarm text, and review explanations; adaptive thinking on, `effort`
  tuned per stage (`low` for classification of one candidate, `high` for reading a
  whole intent against a 60-unit hierarchy). A cheaper worker is an eval-driven decision
  later, not a default.
- **Structured outputs everywhere.** `output_config.format` with a strict JSON schema
  for every stage output, ids re-validated against the model afterwards, as `plan.ts`
  does now. No prose is ever parsed.
- **Prompt caching.** The Standard, the equipment library and the class descriptions are
  a large, stable prefix. Cache them with a one-hour TTL; the volatile part (this
  project's candidates and the engineer's sentence) comes after the breakpoint. A
  1,248-tag project then costs the tokens of its candidates, not of its rules.
- **Refusal handling and fallbacks.** Check `stop_reason` on every call; a refused or
  failed call degrades to the deterministic result with a visible line in the timeline,
  which is the current behaviour and must stay.
- **Provider seam.** Anthropic API; the customer's Amazon Bedrock (Mantle client) or
  Microsoft Foundry tenancy; an OpenAI-compatible on-prem endpoint for open-weight
  models; and `none`. The on-prem path gets the same strict schemas and a smaller
  prompt, and the eval harness reports its accuracy separately so nobody is surprised.
- **Retrieval for the mentor.** Index the installed feature guide locally; answers cite
  the page. No document leaves the machine.
- **Vision for screen recreation only.** A screenshot or photo goes to the model with
  the part list and the grid, and comes back as a strict-schema proposal of parts,
  slots, text and probable equipment. Positions snap to the grid, bindings are left
  unbound and marked, and nothing reaches the export until each object is accepted. The
  image never leaves the machine on the `none` provider, where the path is simply
  unavailable and says so.
- **Never geometry.** The conversation edits the Plant Model with a slot vocabulary
  ("put the flow reading on the pump faceplate", "move dosing to its own screen"), and
  the layout engine re-projects. This retires the coordinate problem rather than tuning
  it.

### 4.5 Evaluation: the thing that makes quality a number

- **Golden corpus.** Twenty to fifty real or realistic exports across pump stations,
  motor lines, batch, water, HVAC, packaging; for each, the equipment an experienced
  engineer would identify, the hierarchy, the bindings, and the alarm priorities.
- **Metrics.** Equipment precision and recall; role-binding accuracy; hierarchy
  agreement; alarm priority distribution against 80/15/5; style-guide conformance
  score; object count against panel limits. Reported per provider.
- **Gate.** No prompt, model, rule pack or matcher change ships if binding accuracy
  drops. Run the corpus through the Batch API for the connected providers at half cost,
  and locally for the on-prem path.
- **Property tests on the format**, kept: two implementations, structural diff, symbol
  geometry byte-identical.

### 4.6 Validation rule packs

Rules are data with a version, grouped into packs, each finding carrying an `objectId`
or tag as today.

| Pack | Examples |
|---|---|
| **OTE format** | naming and reserved words, duplicate names, binding integrity, type compatibility, **objects per screen against the target model's limit**, folder depth ≤ 2 |
| **ISA-101** | L1 shows no live values unless abnormal; every screen has the folder's master navigation; no saturated colour in a normal state; one faceplate layout per class; alarm banner present where the unit has alarms |
| **ISA-18.2** | priority distribution; every alarm has cause/consequence/action; no alarm on a tag without a defined operator response; duplicate alarms across tags of one equipment; no critical alarm's *action* implemented on the HMI |
| **Customer style guide** | palette only from the Standard; fonts; naming pattern; required header fields |
| **Safety text** | the help's own warnings, as rules: no corrective action for critical alarms on the panel, recipes range-checked |

### 4.7 Persistence, versions and the audit record

- Project file on disk (`.hmic`, plain JSON) beside a local SQLite store of versions,
  findings and eval runs. Git-friendly by construction.
- Every generation and every export writes a **provenance record**: input file hashes,
  model id and provider, prompts, rule pack versions, findings at export, the approving
  user and time. The HTML sign-off report is rendered from it and embedded in the
  `.eote` as a resource, so the evidence travels with the project.
- Electronic approval of an export (name, meaning, time, reason) is the Part 11 seed.
  Not a compliance claim; the structure that lets a regulated site build one.

### 4.8 Security posture

Threat model written down. Signed installers. No telemetry unless enabled. Secrets in
the OS keychain. Dependency and patch process. Model calls carry tag names and comments
only, never the skeleton or graphics, and the provider in use is always visible in the
UI. This is the shape IEC 62443-4-1 asks for, and it is what a Schneider product team
will ask about before anything else.

---

## 5 · The engineer's day (UX re-think)

The primary object on screen is the **Plant Model tree**, not the canvas. The canvas is
what a node looks like on the target. This one inversion fixes most of the prototype's
awkwardness: navigation is a tree property, faceplates are class properties, alarms are
an equipment property, and the conversation talks about things with names.

Workflows, in the order engineers meet them:

1. **New project from an export.** Drop `.xvm` or CSV. See the equipment the tool
   found, with confidence, and the ones it could not place. Fix a class in one click;
   the tool learns the convention for the rest of the file.
2. **Choose the Standard.** Ship-with defaults (an ISA-101 grey set), or import the
   customer's palette and templates. Everything downstream inherits it.
3. **Say what you want.** "Overview plus one screen per skid, dosing gets its own,
   operators need start/stop on faceplates." The plan appears as a tree; accept or
   redirect.
4. **Watch it build.** The timeline as today, now nine stages with real counts.
5. **Rationalise alarms.** A table, not a list: priority, setpoint, cause, consequence,
   action, drafted and awaiting approval. Distribution meter against 80/15/5.
6. **Validate.** Findings grouped by pack; click one, land on the object.
7. **Bind devices.** Driver, equipment, IP; addresses from the export; a map of what is
   still internal.
8. **Export and sign.** `.eote`, `.co` library, sign-off record; approval recorded.
9. **Brownfield.** Open the existing `.eote`; the tree shows what the tool understood
   and what it is carrying through untouched; add a unit; export; the diff is only the
   unit.

### 5.1 Bring your own screens

The engineer does not always start from tags. They start from what they have, and the
product has to take all of it.

| What they bring | How it comes in | What they can do next |
|---|---|---|
| **An existing `.eote` project** | The reader (§4.3). Screens, variables, alarms, bindings, folders and master screens become editable; everything else is preserved untouched | Edit any screen on the canvas or in words; add units through generation; run the rule packs as a review; re-export with only their changes in the diff |
| **A single screen from another project** | Open the source `.eote`, pick screens, import into the current project. Names are de-duplicated and the corrections reported, bindings re-pointed to this project's variables or left dangling and flagged | Adopt a colleague's alarm screen or settings page without rebuilding it |
| **Compound objects (`.co`) and libraries (`.pkg`)** | Import into the Library as equipment classes or plain objects. The exposed properties become the role slots the generator binds to | Use the company's own faceplates everywhere the generator would have used ours |
| **A screenshot, photo or PDF of a screen** | The model, with vision, proposes a screen: which parts, where, what text, which equipment it seems to show. Proposed only from the part types the packager can emit, laid out on the grid, shown as a proposal with every guessed binding marked unbound | Recreate a legacy Vijeo, third-party or paper screen as a starting point, then bind and correct. Never exported without the engineer accepting each object |
| **A Vijeo Designer export** | Migration path, dependent on Schneider (§3.3) | Same as an opened `.eote` once mapped |
| **A tag export alone, or nothing** | Today's path, or a blank screen with the full editor | Build by hand, or ask for pieces one at a time |

Editing an imported screen is the same editing as a generated one: canvas, inspector,
layers, alignment, grouping, undo, and the conversation. Ask "replace these lamps with
N-state lamps bound to the same tags" or "apply our style guide to this screen", and the
result appears as a proposal with a diff against the original, accepted object by object.
Imported objects the tool cannot model are shown as opaque placeholders on the canvas, in
their real position and size, so layout decisions are made against the real screen, and
they leave untouched.

Applying the Standard to an imported screen is a first-class action. The rule packs run
on it exactly as on generated output, so an old project can be reviewed against ISA-101
and ISA-18.2, and the findings fixed one by one or in bulk, with each fix reversible.

### 5.2 No dead ends

The rule that makes the product trustworthy to an experienced engineer: **every option
is available at every point.**

- Every generated object is an ordinary object. Move it, rebind it, restyle it, delete
  it. The generator records the edit as an override and never reverts it on regeneration.
- Every stage of the pipeline can be run alone, skipped, or done by hand: import tags
  without generating, generate one unit's faceplate, rationalise alarms for a project
  built entirely by hand, validate a screen someone else drew.
- Every AI proposal shows a diff and waits. Accept all, accept some, reject, or edit the
  proposal before accepting.
- The provider is chosen per project, including none. The Standard is chosen per
  project, including none. The target model and format are chosen per project.
- Partial export is allowed and labelled: a `.co` of one faceplate, a screen set
  without alarms, a variable list as CSV for the PLC engineer.
- Nothing the tool did not understand is ever discarded, and the engineer can always see
  the list of what is being carried through untouched.

---

## 6 · Roadmap

Ordered by what unblocks the next thing, and by what to show Schneider at each step.

**Phase A · Foundations (weeks 1–4).** The `.eote` reader with byte-identical round
trip; the Plant Model schema and migration of the current store onto it; `.xvm` ingest
with DDT-aware structuring; equipment classes v1 with confidence; golden corpus v0 and
the eval runner. *Demo: open Schneider's own sample projects, edit one screen, re-export,
prove nothing else changed; import a Control Expert export and watch DDTs become
equipment.*

**Phase B · Native OTE (weeks 5–8).** Folders, master screens, header/footer,
navigation types; faceplates as compound-object instances per class; the next twelve
parts; devices, drivers, external variables with addresses; logging groups and trends;
screen and `.co` import from other projects; opaque placeholders for unmodelled objects.
*Demo: a generated project whose navigation an OTE engineer would have built by hand;
faceplates open as compound objects; a tag reads from a simulated Modbus device; a
screen lifted from one project into another with its bindings re-pointed.*

**Phase C · Standards (weeks 9–12).** Alarm rationalisation table with ISA-18.2 pack;
ISA-101 pack; the Standard as importable data; "apply the Standard" to an imported
screen with a per-object diff; screenshot-to-screen proposals; provenance and sign-off
with approval. *Demo: the same export, two customers' style guides, two conformant
projects; an alarm flood caught at the desk; a photo of a 2012 Vijeo screen becomes an
editable OTE screen with every binding awaiting confirmation.*

**Phase D · Fit the environment (weeks 13–16).** Tauri packaging and signed installer;
SQLite persistence and versions; provider seam with on-prem endpoint; version matrix
and conformance run; mentor over the offline help. *Demo: the whole loop with the
network cable out.*

**Cut, and say so.** Multi-tenancy and SSO; marketplace or sharing features; real-time
collaboration; part-type breadth for its own sake; the Vijeo migration path until
Schneider says which way that product is going.

---

## 7 · Arriving at Schneider with a position

The internship conversation is won by knowing their product better than the demo
needed to, and by asking questions only someone who has read the installation would ask.

**Bring**

- The round-trip proof on their own sample projects. Nothing says "we respect your
  format" like giving it back byte-identical.
- A `.xvm` → project run, because their engineers live in Control Expert.
- The alarm rationalisation table, because it is the deliverable their customers get
  audited on.
- The provenance record, because it answers the safety question before it is asked.

**Ask**

1. Which panels are their customers actually buying for new projects, and is OTE or
   Vijeo Designer the target for ST6/STM6 in 2026? Their FAQ and product pages disagree.
2. Is there, or will there be, an official project API or a redistributable skeleton?
   That decides whether local-first is the architecture or the workaround.
3. Where is the Industrial Copilot's roadmap for Harmony and OTE, and would an HMI
   agent under their orchestrator be built inside EAE, inside OTE, or beside both?
4. Do they have a headless build or open-and-verify path for conformance testing?
5. Whose equipment library should be canonical: Process Expert's, EAE's, or a customer's?

**Say**

"Siemens ships an initial screen. Nobody ships a project that passes ISA-101 and
ISA-18.2 with the evidence attached, opens a 2019 project without losing anything, and
runs with the cable out. That is what this becomes, and the format layer that makes it
possible is already proven against your product."

---

## 8 · Risks and open questions

- **Licensing** remains the gating decision; local-first keeps every option open.
- **The reader** is harder than the writer and is on the critical path; start it first.
- **DDT coverage** in real exports varies; the regex path must stay first-class.
- **On-prem model accuracy** will trail the connected path; the eval reports it and the
  deterministic floor keeps the product usable.
- **Style-guide ingestion** from a 100-page PDF is a research problem; ship it as a
  structured form first, with the model helping to fill it from the document.
- **OTE version drift.** A 4.5 or 5.0 changes the matrix; conformance runs per release.

---

## Sources

Standards and practice
- ISA-101 practitioner guide: <https://processcontrolguide.com/isa-101-hmi-design/>
- ISA-101 colour and levels: <https://industrialmonitordirect.com/blogs/knowledgebase/isa-101-high-performance-hmi-design-principles-color-strategy>
- ISA-101 overview: <https://hmilibrary.com/standards/isa-101>, <https://www.realpars.com/blog/high-performance-hmi>
- ISA-18.2 KPIs and 80/15/5: <https://isa.ie/wp-content/uploads/2016/06/Alarm_System_Performance_Metrics_Kim_Van_camp.pdf>, <https://www.yokogawa.com/us/library/resources/media-publications/implementing-alarm-management-per-the-ansi-isa-182-standard-control-engineering/>, <https://ifactoryapp.com/blog/alarm-management-scada-isa-18-2>
- Engineering deliverables (FDS, I/O list, P&ID, issue cycles): <https://plcprogramming.io/pillar/engineering-documentation>, <https://industrialmonitordirect.com/blogs/knowledgebase/writing-a-functional-design-specification-fds-for-industrial-control-systems>, <https://automationforum.co/i-o-list/>
- Estimating effort by point count: <http://control.com/thread/1026177537>, <https://www.unitronicsplc.com/overcoming-the-high-cost-of-hmi-development/>
- PlantPAx paired AOI/faceplate libraries: <https://plcexchange.net/how-to-plantpax-library-process-objects/>, <https://industrialmonitordirect.com/blogs/knowledgebase/implementing-plantpax-faceplates-in-factorytalk-view-studio-me>
- 21 CFR Part 11 for HMI/SCADA: <https://industrialmonitordirect.com/blogs/knowledgebase/selecting-scada-systems-for-fda-21-cfr-part-11-compliance>, <https://perfval.com/part-11-compliance-considerations-for-scada-systems/>
- IEC 62443-4-1: <https://webstore.iec.ch/en/publication/33615>, <https://www.securitycompass.com/blog/iso-iec-62443-4-1-and-62443-4-2/>

Schneider
- OTE product range: <https://www.se.com/us/en/product-range/62621-ecostruxure-operator-terminal-expert/>
- Vijeo Designer and Harmony FAQ (ST6/STM6 on Vijeo; migration tool on hold): <https://www.se.com/us/en/faqs/FAQSET0000003-vijeo-designer-harmony-hmi-faqs-schneider-electric/>
- Control Expert `.xvm` export and Symbol Link import: <https://industrialmonitordirect.com/blogs/knowledgebase/control-expert-derived-data-types-to-vijeo-designer-import-guide>, <https://www.se.com/fr/fr/faqs/FA19189/>
- Machine Expert symbol configuration: <https://product-help.schneider-electric.com/Machine%20Expert/V1.1/en/SoMProg/SoMProg/Symbol_Configuration_Editor/Symbol_Configuration_Editor-4.htm>
- Industrial Copilot (Automation World interview): <https://www.automationworld.com/process/digital-transformation/article/55305398/schneider-electric-inside-the-new-industrial-copilot-with-schneider-electrics-aurelien-lesant>
- Hannover Messe 2026 agentic manufacturing release: <https://www.se.com/ww/en/about-us/newsroom/news/press-releases/Schneider-Electric-unveils-next-generation-agentic-manufacturing-capabilities-powered-by-Microsoft-Azure-AI-at-Hannover-Messe-2026-69e08de2ddabef15890a48f3/>
- EAE object libraries with HMI facets: <https://www.se.com/us/en/product-range/23643079-ecostruxure-automation-expert/>
- OTE 4.4 offline feature guide, read locally: `Buildtime/Help/en/featureguide/` (screen structure, master screens, navigation, alarms, logging, security, scripts, object limits)

Competitors
- Siemens Engineering Copilot TIA: <https://www.siemens.com/en-us/products/tia-portal/engineering-copilot-tia-standard/>, <https://press.siemens.com/global/en/pressrelease/siemens-xcelerator-scaling-roll-out-generative-ai-siemens-industrial-copilot>
- Siemens Eigen Engineering Agent: <https://www.siemens.com/en-us/products/tia-portal/eigen-engineering-agent/>
- TIA Portal V21 review noting cloud-only copilot: <https://controlbyte.tech/blog/tia-portal-v21-new-features/>
- Rockwell Design Studio Copilot and Optix: <https://www.packworld.com/trends/digital-transformation/article/22927841/rockwell-automations-factorytalk-design-studio-adds-generative-ai-copilot>, <https://www.rockwellautomation.com/en-us/products/software/factorytalk/optix.html>

Deployment
- Claude on Bedrock, Vertex, Foundry and air-gap limits: <https://www.infoq.com/news/2026/07/claude-foundry-ga-europe/>, <https://jinba.io/blog/on-premise-claude-deployment-options>, <https://devblogs.microsoft.com/foundry/whats-new-in-microsoft-foundry-june-2026/>
