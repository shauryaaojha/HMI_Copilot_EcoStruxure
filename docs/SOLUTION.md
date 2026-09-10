# HMI Copilot

**From a PLC tag list and a sentence of English to a finished EcoStruxure project.**

Hackathon solution statement · Target platform: EcoStruxure Operator Terminal Expert 4.4

---

## 1. The Problem

> The current engineering workflow relies heavily on manual screen development, expert-driven configuration, and complex tag integration activities. This creates a steep learning curve for new engineers, increases the likelihood of human errors, delays validation and commissioning, and ultimately impacts engineering productivity, project timelines, and consistency in delivering standardized, high-quality solutions.

Four costs, as they actually land on a project:

| Pain point | What it looks like |
|---|---|
| **Manual screen development** | An engineer hand-places every lamp, bargraph and trend, then repeats it for 40 near-identical equipment screens. |
| **Expert-driven configuration** | Only senior engineers know which object, animation and colour standard to use. Juniors block on them. |
| **Complex tag integration** | Hundreds of PLC symbols mapped by hand onto object properties. One wrong binding stays invisible until commissioning. |
| **Inconsistency** | Two engineers on one project produce two different-looking, differently-named HMIs. |

They compound: **validation and commissioning slip**, because errors surface on site instead of at the desk.

---

## 2. The Solution

**HMI Copilot** turns a PLC tag export plus plain-English intent into a **complete, validated EcoStruxure project** — screens drawn, tags declared, alarms configured, bindings wired — while a live canvas shows the engineer each object as it is generated.

```
  PLC tag export (.csv / .xlsx / symbol file) ─┐
                                               │
  "Two pump station with running lamps,       ─┼──▶  HMI COPILOT  ──▶  project.eote
   a flow display and a high-level alarm"      │           │           validation report
                                               │           │
  Company standards (naming, colours, layout) ─┘           ▼
                                               LIVE CANVAS + BINDING MAP
                                               (the engineer sees and steers it)
```

One file. **File ▸ Open Project** and the HMI is there — nothing to import, nothing to assemble.

The engineer stays in control throughout: the AI proposes, the canvas makes the proposal legible, and a human accepts, edits or redirects.

---

## 3. This Is Built, Not Proposed

The decisive question for any "AI builds your HMI" idea is whether the output actually loads into the engineering tool.

**It does. We generated a project and opened it in EcoStruxure Operator Terminal Expert.** It contains a laid-out screen, seven typed tags, five configured alarms and eleven bindings — none of it touched by hand.

That was possible because the project format turned out to be fully legible. It was established from the templates the product itself ships at `Buildtime\BuildtimeData\ProjectTemplates` — `Blank.eote`, two demos and three samples:

```
<project>.eote                  ZIP   (nested entries use BACKSLASH separators)
 ├── Project.dat, Target.dat    JSON   project identity, panel model, resolution
 ├── Variables.db               SQLite the tags
 ├── Alarm.db                   SQLite alarm groups and alarms
 ├── Recipe.db, Security.db, …  SQLite other subsystems
 ├── Bindings.dat               JSON   Sources[] → Bindings[] → Targets[] graph
 ├── Screens\Hierarchy.dat      JSON   screen order
 └── Screens\<guid>\
      ├── Screen.dat            JSON   the object tree
      ├── Metadata.dat          JSON   name, id, order
      └── LocalVariables.db     SQLite
```

Four properties make full automation possible:

1. **Everything meaningful is plain JSON or plain SQLite.** `Screen.dat` is a tree of `Type` / `Children` / `Location` / `Width` / `Height`; `Variables.db` is an ordinary table of tags. Both generate and diff like any other document.
2. **No signature, no encryption.** Every project carries `_metadata` with `"EncryptionInfo": null, "SignatureInfo": null`.
3. **Bindings are declarative.** Wiring a tag to a display is `{"BindingText": "FT_101_PV.Value", "TargetProperty": "CurrentValue"}` joined through `Sources` and `Targets`. An alarm binds the same way, through `VariableName`. This is precisely the work that "complex tag integration" costs an engineer days of.
4. **The geometry maps onto the browser.** Screens position parts absolutely — `Location: {Left, Top}` plus `Width`/`Height` inside a `ViewBox` sized to the panel — which is a direct match for absolutely-positioned SVG. Colours are indices into the project palette, resolved from the product's own `CommonScripts/Colors/Colors.lua`.

Property 4 carries the whole user experience: **the same JSON that becomes the project file drives the live preview.** One model, two renderers. The preview cannot lie about the output.

Generation is grounded twice. The tool's machine-readable schemas in `Buildtime/PropertyDefinitions/` define every property of Screen, Variable, 25 parts and 13 layout objects, so invented properties are structurally impossible. And every part shape and binding property name we emit was **extracted from the shipped sample projects rather than guessed** — `reference/part_examples.json` records one real example of each of the 50 part types those projects use.

> **A note on compound objects.** An earlier iteration generated compound objects (`.co`) to be imported and dragged onto a screen. Whole-project generation replaced it for three reasons: there is nothing to assemble by hand; screens cannot be imported at all, so a project is the only route to a finished screen; and creating compound objects is a **licensed** feature, while placing parts on a screen is not. The compound-object packager still works and remains a secondary output for teams wanting reusable library components.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  WEB CLIENT                                                          │
│  Intent · Live HMI canvas · Binding map · Validation · Timeline       │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  SSE — one finished object at a time
┌───────────────────────────────▼──────────────────────────────────────┐
│  ORCHESTRATOR                                                        │
│                                                                      │
│    Tag Ingestion ──▶ Equipment Inference ──▶ Layout Planner          │
│          │                   │                      │                │
│          │                   ▼                      ▼                │
│          │            Part Selector ──────▶ Screen Generator         │
│          │        (50 real part shapes)   (schema-grounded JSON)     │
│          │                                          │                │
│          └────────────▶ Binding Resolver ◀──────────┘                │
│                               │                                      │
│                               ▼                                      │
│                       Validation Engine                              │
│                               │                                      │
│                               ▼                                      │
│                       Project Packager                               │
│         (.eote: screens · Variables.db · Alarm.db · Bindings.dat)    │
└──────────────────────────────────────────────────────────────────────┘
```

**Tag Ingestion** — parses OTE variable exports (`.csv`/`.txt` UTF-8 without BOM, `.xlsx`), Machine Expert symbol files and generic tag lists, normalising to `{name, dataType, address, scanRate, comment}` across the IEC types OTE supports.

**Equipment Inference** — clusters tags into equipment from naming patterns and comments: `PMP_101_RUN`, `PMP_101_FLT`, `PMP_101_SPD` become one pump with a run state, a fault and a speed. This is where expert knowledge lives — a pump *should* have a fault alarm, so a missing one is flagged rather than silently skipped.

**Part Selector** — picks the right part for each tag from the 50 types the product ships, using real shapes rather than invented ones. Reuse over invention is what produces consistency.

**Layout Planner** — positions parts inside a `ViewBox` sized to the target panel, respecting reading order and alarm-banner conventions.

**Screen Generator** — emits `Screen.dat` JSON constrained by the relevant `.propDef` schema.

**Binding Resolver** — produces the `Sources`/`Targets`/`Bindings` graph: tags to display properties, and trigger tags to alarms.

**Validation Engine** — see §6.

**Project Packager** — starts from the shipped `Blank.eote` skeleton, writes the tags into `Variables.db` and the alarms into `Alarm.db`, adds each screen under `Screens\<guid>\`, emits `Bindings.dat`, and repacks the ZIP using the backslash entry names the product itself writes.

---

## 5. The User Interface

> A chatbot is the wrong interface for this problem. Engineering trust is visual: an engineer will not accept a screen they did not see being built, and cannot sign off a binding they cannot inspect. **The UI is the product.**

The model is Lovable / Cursor-style — a conversation that *drives* a live artifact, with the artifact, not the chat, at the centre.

```
┌──────────────┬──────────────────────────────────┬──────────────────┐
│  INTENT      │        LIVE HMI CANVAS           │   INSPECTOR      │
│              │                                  │                  │
│ ┌──────────┐ │  ┌────────────────────────────┐  │ Object Tree      │
│ │ tags.csv │ │  │ ▓▓ Pump Station 1          │  │ Bindings         │
│ │ 247 tags │ │  │ ┌──────┐ ┌──────┐  ┌─────┐ │  │ Validation ③     │
│ └──────────┘ │  │ │PUMP 1│ │PUMP 2│  │ 62.4│ │  │ JSON / Diff      │
│              │  │ │ RUN  │ │ RUN  │  │  %  │ │  │ ───────────────  │
│ "Add a high  │  │ └──────┘ └──────┘  └─────┘ │  │ Lamp_PUMP1_RUN   │
│  level alarm │  │ ⚠ LT_101_HI  HIGH LEVEL    │  │  Bind PMP_101_RUN│
│  banner"     │  └────────────────────────────┘  │  Why?  ⓘ         │
│              │                                  │                  │
│ [ ▸ Send  ]  │   ● Live ○ Static  [Export]      │                  │
├──────────────┴──────────────────────────────────┴──────────────────┤
│ ✓ Parsed 247 tags  ✓ 2 pumps, 1 tank  ⟳ Binding FT_101_PV …        │
└────────────────────────────────────────────────────────────────────┘
```

### What makes the AI's work visible

**1 · Streaming object-by-object render.** Objects appear as their JSON completes — never a spinner followed by a finished screen. The engineer watches the HMI assemble itself. This alone separates "a black box produced a file" from "I saw it work".

**2 · A build timeline in engineering language.** Not "Thinking…" but `Parsed 247 tags → Detected 2 pumps, 1 tank → Selected Lamp for PMP_101_RUN → Bound FT_101_PV → NumericDisplay.CurrentValue`. Every step is clickable and highlights what it produced.

**3 · The binding map.** Tags on the left, object properties on the right, drawn connectors between them, rendered from the real `Sources`/`Targets` graph. Unbound tags glow amber, type mismatches red. The highest-value view in the product, because this is the stated pain point and today it is invisible until commissioning.

**4 · Live simulation.** Flip to **Live** and simulated (or real Modbus/OPC-UA) values drive the canvas: lamps change state, numbers move, alarms fire. Behaviour is validated before any hardware exists. This is the demo moment.

**5 · Explain-this-object.** Hover any element for *why it exists*: which tags produced it, which part type was chosen, which standard set its colour. Auditability is what makes a senior engineer willing to sign the screen off.

**6 · Diff-on-change.** Ask for a change and the JSON diff appears beside an animated canvas transition. Nothing changes silently.

**7 · Version timeline.** Every generation is a snapshot — scrub back, branch, compare. Standard practice in software, absent from HMI engineering.

### Why SVG, not a canvas element

The preview renders `Screen.dat` into **SVG DOM nodes, one per object**, each carrying its `UniqueId`. That yields, essentially free: click-to-select and hover-to-inspect mapped straight back to the JSON node; absolute `Location`/`Width`/`Height` matching OTE's own screen model one-to-one; palette indices resolved to exact colours; CSS transitions for animation and diff highlighting; crisp rendering at any zoom; and trivial PNG export for documentation.

Because preview and export are the same JSON, **what the engineer approves is what OTE opens.**

### Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | **Next.js (App Router), full stack** | One repo, one language, one deploy — no CORS, no second dev server |
| Canvas | Inline SVG | Direct mapping to the OTE screen model |
| State | Zustand + immer | JSON tree with cheap undo/redo |
| Transport | SSE from a route handler | Streams generation events object by object |
| AI | Claude (`claude-opus-5`) via `@anthropic-ai/sdk` | `messages.parse()` with `zodOutputFormat` gives schema-grounded JSON |
| Tag parsing | SheetJS | `.csv` / `.txt` / `.xlsx` ingestion |
| Packager | `jszip` + `sql.js`, Node runtime | Produces the `.eote` |

Three notes on the packager. The route must declare `runtime = 'nodejs'`, not Edge. ZIP entry names must use **backslash** separators, matching what OTE writes. And most SQLite files (`Recipe.db`, `Security.db`, `Language.db`, …) are copied verbatim from the `Blank.eote` skeleton as static assets — only `Variables.db` and `Alarm.db` are written, which `sql.js` handles with no native module, so the packager runs anywhere including serverless.

Generation streams **one complete object at a time** rather than parsing partial JSON: more robust, and a natural fit for the build timeline.

---

## 6. Validation — Catching Errors at Design Time

Every project is checked before export, each finding clickable back to the offending object.

**Naming conventions**, enforced from the tool's own documented rules: letters, digits and underscore only; no leading digit; no spaces; no reserved words — the IEC data types (`BOOL`, `INT`, `DATE_AND_TIME`, …), control codes (`ACK`, `BEL`, `CR`, …) and script keywords (`class`, `catch`, `case`, …). Violations are silently dropped on import today; here they are caught and auto-corrected with the change shown.

**Binding integrity** — unbound properties, tags bound to nothing, type mismatches (a `REAL` driving a `BOOL` lamp), out-of-range scaling.

**Completeness** — equipment missing an expected alarm, a trend with no logging, a screen with no navigation.

**Standards conformance** — colour palette, font sizes, alarm-banner placement, resolution fit.

The output is a signed-off HTML report the customer's QA process can consume.

---

## 7. Demonstration

1. Drop in a PLC tag export — 247 tags.
2. Type: *"Two pump station with running lamps, flow and level displays, and a high-level alarm."*
3. Watch the timeline infer equipment while the canvas assembles the screen object by object.
4. Open the binding map — every tag wired, unbound ones flagged amber.
5. Type: *"Add the spare pump and move the alarm banner to the top."* Diff and animated canvas update.
6. Toggle **Live**: lamps change state, values move, the high-level alarm fires.
7. Export → `project.eote` + validation report.
8. **Open the generated project in EcoStruxure Operator Terminal Expert** — the screen, the seven tags, the five alarms and every binding are already there.

Step 8 is the claim no mockup can make, and it is already working.

---

## 8. Impact

| | Today | With HMI Copilot |
|---|---|---|
| First screen for a new equipment type | Hours to days | Minutes |
| Binding ~250 tags | Manual, error-prone | Generated, verified, visualised |
| Errors found | At commissioning, on site | At design time, in the browser |
| New-engineer ramp-up | Months of shadowing | Guided from day one, every decision explained |
| Consistency across engineers | Varies by author | Enforced by shared standards |

The strategic point: this does not replace the HMI engineer. It **encodes the senior engineer's judgement** — which part to use, which alarm every pump needs, which naming standard applies — and makes it available to everyone on the team, every time.

---

## 9. How It Integrates with EcoStruxure

EcoStruxure Operator Terminal Expert is a hybrid-stack product:

| Layer | Stack | Evidence |
|---|---|---|
| **Buildtime** (engineering PC app) | .NET/C# shell with native **Qt5 / C++** modules | `*.deps.json`, EF Core, Roslyn, `Microsoft.Data.Sqlite`, plus `Qt5Core_x64.dll`, `ConnectionBase_x64.dll` |
| **RunTime** (on the panel) | pure **C++ / Qt5** with embedded **Lua** | `PCPlatform.exe`, `Platform.dll`, `CoreDriver.dll`, `Qt5*.dll`, `INIT.luac` |

**We do not merge into that codebase, by design.** HMI Copilot meets it at the **artifact boundary** — producing the files the product already reads. That boundary is language-agnostic, so our stack and theirs never need to meet.

```
   HMI Copilot                   BOUNDARY                 EcoStruxure OTE
   (Next.js / TypeScript)  (files — language-agnostic)   (C# / C++ / Qt / Lua)
        │                            │                            │
   generated JSON  ──▶  project.eote ─┼──▶ File ▸ Open Project ──▶ a built HMI
                                     │
```

This is judgement, not a workaround. Touching the C++ or C# internals would need an unavailable SDK and code signing, would break on every release, and would amount to asking Schneider to maintain a fork of its own product. Staying at the file boundary means the tool works with **any** OTE 4.4+ installation, survives upgrades, and could actually ship.

### Integration ladder

| Tier | Mechanism | Status |
|---|---|---|
| **0 — Artifact** *(this project)* | Generate the `.eote`; the engineer opens it | Working today. Zero coupling, no licence dependency |
| **1 — Lua scripting** | Both layers embed Lua (`DesignTimeScripts/*.lua`, `INIT.luac`) — the product's sanctioned extension point, and runtime scripts can reach the network | Available, natural next step |
| **2 — Native / managed plugin** | Buildtime is .NET, so the generator can be repackaged as an in-process C# library | Needs Schneider's SDK and signing — the productization path |
| **3 — UI automation** | Driving the OTE window programmatically | Brittle; not worth it |

### It can live *inside* OTE later, with no new dependencies

Both layers already ship **`Qt5WebEngine`** — an embedded Chromium — and the parts library already includes a **`WebBrowser`** object. The same interface described in §5 can later be docked inside the engineering tool, and surfaced on the panel at runtime for operator diagnostics, on a runtime Schneider already distributes.

The story is therefore: **a standalone tool producing native artifacts today, an in-product panel tomorrow — with no new technology decision in between.**

---

## 10. Scope and Risks

| Risk | Mitigation |
|---|---|
| Generated project rejected on open | **Retired** — a generated project opens in OTE 4.4. Two variants are produced (a minimal one using only TextBox and Rectangle, and the full one) so any future part-level problem is isolated immediately. |
| Compound-object licensing | Avoided entirely. We place primitive parts directly on screens — the normal authoring route, and not licence-gated. |
| Equipment inference on messy tag names | Inference is a proposal, not an oracle. The engineer confirms the equipment list before generation; the UI makes correction one click. |
| Format drift across OTE versions | Part schemas are read from the installation at run time rather than hardcoded, and `Project.dat` carries a version we check. |

**Deliberately out of scope:** device driver configuration, PLC logic, physical panel download, and safety-instrumented functions. Generated variables are internal, which keeps the demo hardware-free and lets the simulator drive the screen.

---

## 11. Beyond the Hackathon

- **Standards packs** — a customer loads their own library and naming rules, and the Copilot generates in *their* house style.
- **Brownfield mode** — ingest an existing project, report standards drift, propose fixes.
- **Machine Expert round-trip** — regenerate screens when PLC symbols change, closing the loop the symbol-link feature opens.
- **Commissioning assistant** — replay logged values through the live canvas to reproduce field issues at a desk.

---

## Appendix: Evidence

Verified against a local EcoStruxure Operator Terminal Expert 4.4 installation.

| Claim | Source |
|---|---|
| A generated project opens in OTE | `demo_project/HMICopilot_PumpStation.eote` — 19 parts, 7 tags, 5 alarms, 11 bindings, generated by `tools/make_project.py` |
| `.eote` is a ZIP of JSON + SQLite, unsigned and unencrypted | `Buildtime/BuildtimeData/ProjectTemplates/*.eote` → `Project.dat`, `Screens\<guid>\Screen.dat`, `Bindings.dat`, `_metadata` |
| `Variables.db` is plain SQLite | `Variables` table: `Name`, `DataType`, `InitialValue`, `Comments`, `DeviceAddress`, … |
| `Alarm.db` holds groups and alarms | `AlarmGroup` + `Alarm` tables; `AlarmType` 1–4 = HiHi/Hi/Lo/LoLo, `AlarmRecordType` 1 = bit, 2 = level |
| Alarms bind to a trigger tag | Target `ObjectType 30`, `SubType` `BoolAlarm`/`LevelAlarm`, `TargetProperty` `VariableName` |
| Display bindings | `Lamp.CurrentValue`, `NumericDisplay.CurrentValue`, `TextBox.Text`, `Switch.ClickTrigger.Destination` |
| Real part shapes, not guesses | 50 part types extracted from the shipped samples → `reference/part_examples.json` |
| Screen colours are palette indices | `Buildtime/CommonScripts/Colors/Colors.lua`, ColorSet 4 "Green-Simple" |
| Machine-readable schemas for every object | `Buildtime/PropertyDefinitions/` — Screen, Variable, 25 parts, 13 layout objects |
| Screens cannot be imported; compound objects can | `Help/en/featureguide/` — import/export docs exist for compound objects, variables, alarms, recipes, logging, language and security, but not screens |
| Compound-object creation is licence-gated | Compound Object Explorer: "The current license does not support creation/modification of compound objects" |
| Naming rules and reserved words | `Help/en/featureguide/appendix/naming_conventions.htm` |
| Supported IEC data types | `Help/en/featureguide/variables/reference.htm` |
| Buildtime is .NET + Qt; RunTime is C++/Qt + Lua | `*.deps.json` and `Qt5*.dll` in `Buildtime/`; `PCPlatform.exe` and `INIT.luac` in `RunTime/` |
