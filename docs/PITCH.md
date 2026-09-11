# HMI Copilot

**From a PLC tag list and one sentence of English to a finished EcoStruxure
project.**

Schneider Electric hackathon, Problem Statement 3. Target platform: EcoStruxure
Operator Terminal Expert 4.4.

If you are unfamiliar with any term below, `docs/EXPLAINER.md` defines all of
them from zero, with worked examples.

---

## 1 · The problem, in money and risk

The brief describes manual screen development, expert-driven configuration and
complex tag integration. Here is what each of those actually costs.

An HMI engineer receives a tag export from the PLC programmer: a spreadsheet
with a few hundred to a few thousand rows, each one a named value inside the
controller. From that, by hand, they must produce a working operator interface.

| What they do | What it costs |
|---|---|
| Declare every tag in the HMI project | Hours of transcription, then correction |
| Draw every screen | Days. Forty near-identical equipment screens, hand-placed, and the fortieth is not identical to the first |
| **Connect every object to its tag** | **Days. Several hundred connections, one dialog box at a time** |
| Configure alarms | Hours, and the omissions are invisible |
| Find the mistakes | On site, during commissioning, with the panel already on the wall |

Three of those five rows are tedium. The fourth is a risk register.

**A wrong binding is invisible.** If the lamp labelled PUMP 1 is connected to
pump 2's running bit, the screen looks completely normal. The lamp lights. The
number moves. It is simply the wrong number, under the wrong label, and the only
way to find out is to run the plant and notice that reality disagrees with the
display.

That is not a rendering bug. An HMI is what an operator reads during an upset,
at three in the morning, when deciding whether to open a valve. A binding error
is the kind of thing that appears in an incident report.

So the four costs are not four features to speed up. They are:

- **Schedule risk.** Screen development and binding sit on the critical path,
  and errors surface at the most expensive possible moment, on site.
- **Key-person risk.** Only senior engineers know which object, which animation
  and which colour standard to use. Juniors block on them. That knowledge is in
  people, not in the tooling.
- **Consistency risk.** Two engineers on one project deliver two differently
  shaped, differently named HMIs, and the customer maintains both forever.
- **Safety risk.** The one that matters. A silent wrong binding, shipped.

**HMI Copilot moves all four to the desk.** A tag export plus a sentence
produces a complete, validated project, with every object visible as it is
generated and every binding inspectable before anyone approves it.

---

## 2 · The insight

Every "AI builds your HMI" idea dies on the same question: does the output
actually load into the engineering tool?

Ours does, and the reason is a property of the format that we established by
unpacking the template projects the product itself ships at
`Buildtime\BuildtimeData\ProjectTemplates`.

**An `.eote` project is completely legible.** It is a ZIP of plain JSON and
plain SQLite. Four properties follow, and if any one of them were false this
product could not exist in this shape.

**1. Everything meaningful is plain JSON or plain SQLite.**

```
<project>.eote                       ZIP  (nested entry names use BACKSLASHES)
 +-- Project.dat, Target.dat         JSON    identity, panel model, resolution
 +-- Variables.db                    SQLite  the tags
 +-- Alarm.db                        SQLite  alarm groups and alarms
 +-- Bindings.dat                    JSON    Sources -> Bindings -> Targets
 +-- Screens\<guid>\Screen.dat       JSON    the object tree
 +-- Recipe.db, Security.db, ...     SQLite  other subsystems
```

`Screen.dat` is a tree of `Type` / `Children` / `Location` / `Width` /
`Height`. `Variables.db` is an ordinary table with `Name`, `DataType`,
`Comments`, `DeviceAddress`. Both generate, diff and review like any other
document.

**2. There is no signature and no encryption.** Every project carries
`_metadata` with `"EncryptionInfo": null, "SignatureInfo": null`. A file we
write is as valid as a file the product wrote. **Nothing has to be defeated, and
nothing is.**

**3. The wiring is declarative.** Connecting a tag to a display is
`{"BindingText": "FT_101_PV.Value", "TargetProperty": "CurrentValue"}`, joined
through `Sources` and `Targets` arrays by index. An alarm binds the same way,
through `VariableName`. The single most expensive manual task in the job turns
out to be the most mechanisable thing in the file.

**4. The geometry maps onto the browser.** Screens position objects absolutely:
`Location: {Left, Top}` plus `Width`/`Height` inside a `ViewBox` sized to the
panel. That is precisely how absolutely-positioned SVG works. Colours are
indices into the project palette, resolved out of the product's own
`Buildtime/CommonScripts/Colors/Colors.lua`.

Property 4 carries the entire product experience: **the same JSON that becomes
the project file drives the live preview.** One model, two renderers.

---

## 3 · What is novel here

Five claims. Each one is a design decision that could have gone the other way,
and each is held by something in the repository rather than by intent.

### 3.1 One model, two renderers, so the preview cannot lie

The canvas does not draw a picture of what the export will contain. It draws the
export. The same `Screen.dat` object tree is rendered to SVG for the engineer
and serialised into the `.eote` for the product.

The corollary is visible on stage in one second: **toggle the application theme
and the HMI screen does not change.** The application chrome is ours and is
themed; the screen's colours are palette indices resolved out of the project's
own colour set, so theming it is not possible without breaking the claim. A test
asserts the rendered screen contains no application design token and only
palette hex.

### 3.2 The artifact boundary: we never fork Schneider's product

EcoStruxure Operator Terminal Expert is a hybrid: Buildtime is a .NET/C# shell
with native Qt5/C++ modules; RunTime is C++/Qt5 with embedded Lua. **We do not
merge into that codebase, by design.**

```
   HMI Copilot                     BOUNDARY                    EcoStruxure OTE
   (Next.js / TypeScript)     (files, language-agnostic)   (C# / C++ / Qt / Lua)
        |                            |                              |
   generated JSON  --------->  project.eote  ---> File > Open Project ---> a built HMI
```

This is judgement, not a workaround. Touching the internals would need an
unpublished SDK and code signing, would break on every release, and would amount
to asking Schneider to maintain a fork of its own product. Meeting at the file
boundary means the tool works with **any** OTE 4.4+ installation, survives
upgrades, and could actually ship.

### 3.3 Generation grounded in the product's own machine-readable schemas

`Buildtime/PropertyDefinitions/` contains machine-readable definitions for
Screen, Variable, 25 parts and 13 layout objects. Our zod schemas are derived
from them, and every part shape and binding property name we emit was
**extracted from the shipped sample projects rather than guessed**:
`reference/part_examples.json` records one real example of each of the 50 part
types those projects use.

The model is then constrained to those schemas by the provider's structured
output. An invented property fails parsing rather than reaching the canvas.

And where a schema cannot express a constraint, it is checked rather than
trusted. A schema can say `include` is an array of strings; it cannot say every
string must be one of the equipment ids inference just found. So `plan.ts`
re-checks them, with the reason in the code:

```ts
// No schema can express "must be one of these ids", so it is checked here
// rather than trusted. A hallucinated id would place an empty card.
```

### 3.4 The compiler enforces "the canvas may only render what the packager can emit"

This is the project's one rule, and it is held by `tsc`, not by discipline.

`Part` is a discriminated union of six shapes. `PartNode` switches over it, and
the default branch assigns the remainder to `never`:

```ts
default: {
  const exhaustive: never = part;
  void exhaustive;
  return null;
}
```

**Add a seventh part type to the format layer and the canvas stops compiling
until it can draw it.** The reverse also holds: the interface cannot invent a
visual, because there is no schema case to render it from.

The rule reaches further than the canvas. In the symbol library, a symbol whose
index entry lacks the `Commands`/`Points` a `Path` part needs is shown greyed
with the reason rather than placed. In the conversation, the operation schema's
part type is the same `PART_TYPES` constant, so a model cannot name a part the
packager cannot write.

And the second half of the claim is held by a test: `web/tests/canvas.test.ts`
renders the fixture and checks it against the rules the independent Python
renderer used to draw `assets/screen_design.png`, **restated rather than
imported**, so the two renderers cannot drift together and still pass.

### 3.5 The UI is the product, not a chatbot

A chatbot is the wrong interface for this problem. Engineering trust is visual.
An engineer will not accept a screen they did not see being built, and cannot
sign off a binding they cannot inspect.

So the artifact is at the centre and the conversation drives it:

- **Streaming, object by object.** Objects appear as their JSON completes. Never
  a spinner followed by a finished screen. The engineer watches the HMI assemble
  itself.
- **A timeline in engineering language.** `Parsed 1,248 tags → Detected 12
  pumps, 21 instruments, 14 motors → Placed 434 objects across PlantOverview,
  PumpsUnit, ... → Configured 232 alarms → Bound 93 display properties and 232
  alarm triggers → 0 errors, 0 warnings`. Never "Thinking...". Every detail line
  is computed from what that step actually produced.
- **The binding map.** Tags left, object properties right, connectors between,
  drawn from the real graph. Green for a display binding, amber for an alarm
  trigger. Unbound rows come from the validation findings rather than a second
  check of their own, so the map and the validation list cannot disagree.
- **A conversation, not one shot.** An engineer never describes a screen right
  the first time. Every turn is undoable as a unit, and an edit asked for in
  words takes the same code path as an edit made with the mouse.
- **Live simulation.** Simulated values drive the canvas: lamps change state,
  numbers move, alarms fire. Seeded, so the same project gives the same run.

---

## 4 · Proof, not promise

The decisive claim is narrow and checkable.

> **A generated project opens in EcoStruxure Operator Terminal Expert 4.4, and
> was never saved by the product.**

| File | Written by | Status |
|---|---|---|
| `demo_project/HMICopilot_PumpStation.eote` | `tools/make_project.py`, the Python reference | opens in OTE 4.4 |
| `demo_project/HMICopilot_TS.eote` | `web/src/lib/ote/packager.ts`, the browser path | opens in OTE 4.4 |

Open either with **File ▸ Open Project**. In the product's own tree: Screens (1)
shows `S00001 : PumpStation1 [View Box]`, All Variables shows 7, All Alarms
shows 5, and the screen renders with both pump lamps, both fault lamps, both
numeric displays and the product's own alarm summary grid.

| | |
|---|---|
| 19 | parts placed on the screen |
| 7 | typed tags in `Variables.db` |
| 5 | alarms in `Alarm.db` |
| 11 | bindings wired |
| **0** | **objects placed by hand** |

Two further things make that claim harder to wave away.

**Two independent implementations agree.** `tools/make_project.py` is the Python
reference where every format detail was established first, on the Windows
machine that has the product. `web/tests/packager.test.ts` structurally diffs
the TypeScript packager against it: same entries, same binding graph, same
`Variables.db` and `Alarm.db` rows, the copied-through databases byte-identical.
Two implementations agreeing is a stronger claim than either one passing its own
tests.

**450 tests.** 437 run anywhere; 13 need a licensed EcoStruxure installation to
extract a skeleton from and skip without one. `cd web && npm test`.

Also worth having on screen: `assets/screen_design.png`, produced by the Python
renderer from the same JSON the browser canvas draws. They match.

---

## 5 · What is built

Honest status. Nothing below is a mockup; where something is partial it says so.

### The format layer

| | |
|---|---|
| `.eote` packager | **done, verified in OTE 4.4.** JSZip + sql.js, Node runtime, no native module |
| `Variables.db` writer | done. Column list read from the table itself, every column quoted |
| `Alarm.db` writer | done. Groups, bit alarms and level alarms |
| `Bindings.dat` builder | done. Display and alarm bindings, both shapes, screen-anchored |
| Palette | done. Colour set 4 "Green-Simple", 60 indices resolved from the product's own Lua |
| Symbol library | done. 474 of 475 shipped graphic objects indexed with geometry preserved, placeable as real `Path` parts |
| Skeleton loader | done, with an injectable source directory so the seam for local generation already exists |

### Generation

| | |
|---|---|
| Tag ingestion | done. CSV / TSV / XLSX / semicolon-delimited / no-header, via SheetJS. Corrections **reported, never applied silently** |
| Equipment inference | done. 20 machine prefixes, ISA-5.1 instrument letters, 8 role suffixes. Offline and deterministic |
| Planning | done. One model call per generation. Gemini or Claude, whichever key is set. Structured output against a schema |
| Multi-screen layout | done. ISA-101 display hierarchy, shared header, navigation strip and alarm banner position across the set |
| Alarm proposal | done. Fault bits, high bits, and the warn-then-act pair on every level reading |
| Binding resolution | done, as a side effect of layout knowing what each object is for |
| Validation | done. Seven rule families, each finding carrying an `objectId` |
| Sign-off report | done. Standalone HTML, no external assets, because a commissioning laptop has no internet |
| Streaming | done. SSE, one complete object at a time, never partial JSON |
| **Offline fallback** | done. With no model key, inference and layout still build a screen and the timeline **says so** rather than implying a model was involved |

### The surface

| | |
|---|---|
| Canvas | done. Inline SVG, one node per object, selection handles, marquee, zoom/pan/fit, grid, snap, smart guides, rulers, context menu, keyboard |
| Screen tabs | done. Add, rename, duplicate, reorder by drag, delete |
| Inspector | done. Property editors **generated from the zod schemas**, so a part gains an editor the moment it gains a schema |
| Layers panel | done, with lock/hide/group kept beside the parts, never inside them |
| Binding map | done, from the real graph, with filters |
| Validation results | done, grouped by severity, each finding clickable back to its object |
| Conversation | done. Four modes, fourteen operations, every turn undoable as a unit |
| Simulation | done. Seeded, lead/lag on duty pumps, deliberate fault injection, alarms driven through their setpoints |
| Export | done. `.eote` + HTML report + `Variables.csv` |
| Supporting screens | done. Landing, Projects, Templates, Library, Standards, History, Settings |
| Persistence | **partial.** Autosaves to browser localStorage with a schema version. Survives reload and navigation; does not survive clearing browser data or moving machine |
| Rehearsal | **partial.** `tests/demo-path.test.ts` checks the data, routes and engine behind every demo beat. Nobody has walked the script on the presenting machine |

**121 TypeScript files, about 18,250 lines, 55 commits.**

### At scale

The 1,248-tag water treatment export, asked for a whole plant:

| | |
|---|---|
| tags parsed | 1,248, with 5 names corrected and reported |
| equipment inferred | 47 units |
| screens generated | 10 |
| objects placed | 486 |
| bindings | 325 (93 display, 232 alarm triggers) |
| alarms | 232 (192 bit, 40 level) |
| validation | **0 errors, 0 warnings** |

One honest caveat: the screen and object counts depend on how the model groups
the plant, and vary between runs. A re-run gave 8 screens and 434 objects from
the same file and the same request. The figures that do not vary are the ones
computed rather than planned: **325 bindings, 232 alarms, 0 errors, 0 warnings**
were identical on both runs, because they follow from the tags rather than from
the plan.

### Deliberately not done

Device driver configuration, PLC logic, physical panel download, and
safety-instrumented functions. Generated variables are internal, which keeps the
demo hardware-free and lets the simulator drive the screen.

---

## 6 · Real production challenges, and what we do about each

This section is deliberately unflattering. A hackathon loop that works is not the
same as a tool an engineer is allowed to use, and being precise about the
difference is worth more than another feature.

### 6.1 Licensing, and the architecture decision it forces

**The problem.** Every `.eote` this product writes contains Schneider's own
database files copied through verbatim: `Recipe.db`, `Security.db`,
`Language.db`, `DriverConfig.db` and the rest. `web/src/lib/ote/skeleton.ts`
reads them from a directory `.gitignore` deliberately excludes, and every
developer extracts their own copy from their own licensed installation. The same
applies to the 475 shipped graphic objects.

**Why it matters.** That is the right posture for a hackathon. It is not a
posture a product can ship in, because **a hosted service needs the skeleton on
the server, and a server holding those files is redistributing them.** This is
not a legal review to schedule later. It picks the architecture.

| | How it works | Cost | Verdict |
|---|---|---|---|
| **A. Local generation** | Runs on a machine that already has a licensed OTE install. The skeleton never moves | Desktop packaging, an update channel | **Build this** |
| **B. Server plans, browser packages** | Layout server-side, the `.eote` assembled in the browser from a skeleton on the engineer's own disk | File System Access API is Chromium-only and fragile; a complex seam | Don't |
| **C. Schneider blesses it** | An OEM agreement covering a redistributable skeleton, or far better, an official project API | A conversation, not code | **Pitch this** |

**What we do about it.** Build for A, pitch for C. They are compatible, and the
seam already exists: `loadSkeleton(dir?)` takes an injectable source, so what
changes is the shell around the format layer, not the format layer. Meanwhile
the boundary is honest in the product rather than hidden: with no skeleton,
`POST /api/export` answers **503** with the setup instruction, and the export
screen says in those words that this is a licensing boundary, not a failure.

Architecture A is also the honest fit for the customer. Plant engineering happens
on restricted and frequently air-gapped networks, and a cloud tool that phones a
model API is a procurement fight at every site.

**What remains.** Desktop packaging, an update channel, and, importantly, a
local or self-hosted model. The offline story has narrowed and it is worth being
exact: generation still runs with no key, because inference is a parse of the
tag names, but the primary interaction is now a conversation, and `/api/chat`
answers *"No model key is configured, so I cannot read a request in words."* So
without a model an engineer gets a one-shot generator, not the product. A
third provider path pointing at an on-premises endpoint is cheap today, while
the seam is still two modules (`lib/ai/converse.ts`, `lib/ai/plan.ts`), and
expensive once the call sites spread.

### 6.2 There is no reader, and round-trip safety is the hard part

**The problem.** There is no `.eote` reader anywhere in `web/`. The product can
create a project and cannot open one.

**Why it matters.** **Most HMI work is brownfield.** An engineer is far more
often adding a pump to a station built in 2019 than starting from nothing.
Today that engineer has no way in. This is the largest single piece of remaining
work.

It is also harder than the writer, because of a property the writer never
needed:

> **Round-trip safety.** Import a project, change one screen, export it, and
> everything you did not understand must come back byte-identical.

Get that wrong once, in a way that silently discards a recipe table or a
security configuration, and the product is finished. Nobody gives it a second
project.

**What we do about it.** The writer was built with exactly this discipline
already: it starts from a real skeleton and copies through verbatim everything
it does not model, rather than synthesising a whole project. That is the same
instinct the reader needs.

**What remains.** All of it, and it should be built as a preservation problem
first and a parsing problem second: read the whole ZIP, model the parts you
understand, carry the rest through untouched, and have a test asserting that an
unmodified round trip is byte-identical.

### 6.3 Persistence

**The problem and what changed.** The store autosaves the project to browser
localStorage with a schema version, so leaving the workspace for the tag screen
or pressing reload no longer loses the work. That is real, and it is local only:
clearing browser data or moving to another machine loses everything, and there
is no server-side storage or recovery.

**Why it matters.** An engineer who spent an afternoon on a screen set expects
it to exist tomorrow, on the machine they were using and after a reinstall.

**What we do about it.** For architecture A, this is a local database and a file
on disk, not a backend. It is deliberately small work, and it must not be
allowed to grow into a multi-tenant service, because that would commit the
project to a hosted architecture before the licensing question in 6.1 is
answered.

**What remains.** Durable local storage, a project lifecycle (open, save-as,
recover), and the version history made permanent rather than in-memory.

### 6.4 Nothing talks to a PLC

**The problem.** Generated variables are internal. `DriverConfig.db` comes
through from the skeleton untouched. The exported project cannot read a single
real value.

**Why it matters.** Until an engineer can point the generated tags at an actual
device, the export is a drawing rather than a project. They will still redo the
tag binding by hand, which is most of the time the product claims to save. This
is the gap most likely to be raised by someone who does this work for a living.

**What we do about it.** Today, nothing, and we say so rather than implying
otherwise: it is listed as explicitly out of scope in the build plan, and it is
what keeps the demo hardware-free.

**What remains.** Driver configuration written into `DriverConfig.db`, and the
device address column of `Variables.db` populated from the tag export's own
address field, which the parser already reads and carries through. That second
half is genuinely close; the first needs the driver database understood to the
same standard as the rest of the format.

### 6.5 The safety position, and why "never auto-deploy" is a feature

**The problem.** An HMI is what an operator looks at during an upset. A binding
that points at pump 2's flow under pump 1's label is not a rendering bug; it is
the sort of thing that shows up in an incident report.

**Why it matters.** The obvious product roadmap for anything like this ends at
"and then it deploys straight to the panel". That destination is wrong.

**What we do about it, and what we will not do.**

**Never move to auto-deploy.** The current design, in which the engineer watches
every object appear and approves before export, is not a hackathon limitation to
grow out of. It is the product's licence to exist, and it should be hardened
rather than smoothed away. No "apply directly to panel" feature, ever.

Two behaviours in the product today follow from that position and are worth
naming, because they are the ones that make an engineer trust it:

- **Corrections are reported, never applied silently.** OTE itself drops an
  illegal tag name quietly on import. We correct it and show the change. This is
  the single most trust-relevant behaviour in the product.
- **Findings carry an `objectId`.** Which is why the binding map and the
  validation list cannot disagree; they read the same array.

**What remains.** Traceability has to be built in rather than added. For a
generated project to be defensible, the record must show which tag export, which
model and version, which prompt, which rules passed, who approved it and when.
Today the store keeps twenty in-memory version snapshots. The standalone HTML
sign-off report is exactly the right instinct and the right container; extending
it into a durable audit record attached to the `.eote` is the work.

### 6.6 Correctness you can prove: there is no eval harness

**The problem.** Generation quality is currently unmeasured. No corpus, no
scoring, no regression gate.

**Why it matters.** For a product whose failure mode is an operator reading the
wrong number, "it looked right in the demo" is not a standard. Any change to the
prompt, the model or the inference could quietly make binding accuracy worse and
nothing would catch it.

**What we do about it.** The first stones are laid, deliberately.
`web/public/demo/` holds seven committed plant exports chosen to cover every
path the importer has: a spreadsheet, a tab-separated file with no header at
all, a semicolon-delimited export of the kind Excel writes on a European locale,
`Symbol`-column naming, and one file that is awkward on purpose (names with
spaces, hyphens and dots, a name starting with a digit, `Order` and `Value`
which are SQL keywords, the same tag three times, and four types spelled
`Analogue`, `boolean16`, `flt` and `??`). `tests/samples.test.ts` holds each to
what the live route actually returns, so a parser change that quietly alters an
import fails there. `samples/` adds seven more plants, from a 20-tag transfer
pump station to a 718-tag chemical plant, each with the prompt it was written
for.

**What remains.** A **golden corpus**: twenty to fifty real tag exports across
pump stations, motor lines, batch and water treatment, and for each, the screens
an experienced engineer would draw and the bindings they would make. Then score
every change against it: binding accuracy, equipment recall, layout sanity, and
ship nothing that regresses binding accuracy.

Two related gaps, named because they are the standards a customer will actually
hold this to:

- **ISA-101** (HMI design: colour use, display hierarchy, situational awareness)
  is encoded in the planner's prompt and in the layout engine's fixed zones, but
  it is not checked by a rule.
- **ISA-18.2 / IEC 62682** (alarm management: priority distribution,
  rationalisation, no alarm without a defined operator response) is not
  implemented at all. On a run that produced 232 alarms, an alarm-flood check
  alone would justify the tool to a lot of plants.

### 6.7 Format drift across versions

**The problem.** Everything here is verified against OTE 4.4 and nothing else.

**What we do about it.** Part schemas come from the installation rather than
being hardcoded, and `Project.dat` carries a version we write and can check.

**What remains.** The packager should detect the target version and **refuse to
write a format it has not been proven against**, rather than produce a file that
opens wrong. That means a conformance suite run against each release, and a
version matrix stating what has been tested.

### 6.8 What we would deliberately cut

Being clear about this is worth as much as the roadmap.

- **Multi-tenancy, SSO, an org model.** Architecture A does not need them, and
  building them commits the project to a hosted service before 6.1 is answered.
- **A component marketplace or template sharing.** Nobody adopts an engineering
  tool for its community.
- **Real-time collaboration.** Two engineers do not edit one HMI screen at once.
  They own different screens and merge in the plant's version control.
- **More part types for their own sake.** Six of the fifty are enough for a pump
  station. Breadth matters far less than the round trip being safe.

---

## 7 · How this merges the gap

### The integration ladder

| Tier | Mechanism | Status |
|---|---|---|
| **0 — Artifact** *(this project)* | Generate the `.eote`; the engineer opens it with File ▸ Open Project | **Working today.** Zero coupling, no licence dependency on our side, works with any 4.4+ install |
| **1 — Lua scripting** | Both layers embed Lua (`DesignTimeScripts/*.lua`, `INIT.luac`), the product's own sanctioned extension point, and runtime scripts can reach the network | Available. The natural next step |
| **2 — Native / managed plugin** | Buildtime is .NET, so the generator can be repackaged as an in-process C# library | Needs Schneider's SDK and code signing. The productisation path |
| **3 — UI automation** | Driving the OTE window programmatically | Brittle. Not worth it |

Tier 0 is the whole demo, and it is the tier that requires nothing from anybody.
That is the point: this can be evaluated today, by opening a file, without a
single decision being made on Schneider's side.

### It can live inside the product later, with no new technology decision

This is the part worth dwelling on.

**Both layers already ship `Qt5WebEngine`,** which is an embedded Chromium
browser. The parts library already includes a `WebBrowser` object. Buildtime
already renders web content, and RunTime already renders web content, on
hardware Schneider already distributes.

Which means the interface described in section 3.5, the streaming canvas, the
binding map, the timeline, the conversation, is not a separate product that
would one day have to be rewritten in C++ or C# to get inside the tool. **It is
already written in the only technology the tool would need to host it.** It can
be docked as a panel inside Buildtime, and a diagnostics view of the same kind
can be surfaced on the panel at runtime.

The story is therefore a straight line rather than a pivot:

> **A standalone tool producing native artifacts today, an in-product panel
> tomorrow, with no new technology decision in between.**

---

## 8 · Impact

| | Today | With HMI Copilot |
|---|---|---|
| First screen for a new equipment type | Hours to days | Minutes |
| A ten-screen application from a 1,248-tag export | Weeks | One generation, watched object by object |
| Binding several hundred tags | Manual, one dialog at a time, error-prone | Generated as a side effect of layout, then visualised and checked |
| Alarms | Configured by hand; omissions invisible | Proposed from equipment knowledge, and a fault tag with no alarm is flagged |
| Illegal tag names | Silently dropped on import | Corrected, and **the correction is shown** |
| Errors found | At commissioning, on site, panel already mounted | At design time, in the browser, before anyone drives anywhere |
| New-engineer ramp-up | Months of shadowing a senior | Guided from day one, every decision explained and inspectable |
| Consistency across engineers | Varies by author | Enforced: one layout engine, one palette, one naming rule set |
| Behaviour verified | On site, with hardware | At the desk, with a seeded simulation, before hardware exists |

The strategic point: **this does not replace the HMI engineer.** It encodes the
senior engineer's judgement, which part to use, which alarm every pump needs,
which naming standard applies, which screen a unit belongs on, and makes it
available to everyone on the team, every time. The engineer's job moves from
placing rectangles to approving decisions, which is the part of it that requires
an engineer.

---

## 9 · What we would do next

In order, with the things that gate everything else first.

**First, decide and de-risk.**

1. **Take the licensing question to Schneider** (6.1) before building further.
   The answer changes what gets built. Build for A, pitch for C.
2. **Start the reader** (6.2) as a preservation problem, with a byte-identical
   round-trip test from day one.
3. **Stand up the golden corpus** (6.6), because without it no later change can
   be shown to be an improvement.

Nothing else matters as much as those three.

**Then, make it keepable.** Durable local persistence and a project lifecycle.
Device driver configuration and real device addresses, so an export is a project
rather than a drawing. The audit trail made permanent and attached to the
`.eote`. This is the point at which an engineer can do a real day's work in it.

**Then, make it defensible.** ISA-101 and ISA-18.2 rules in the validation
engine, an alarm-flood check first. The version matrix and conformance runs
against each OTE release. The sign-off report extended into a genuine record.

**Then, make it fit the environment.** Desktop packaging and an update channel.
Air-gapped install. A local or self-hosted model. Site-level standards, so a
company's own colour set and naming conventions load as **data rather than as
code**, and the Copilot generates in their house style rather than ours.

**And beyond that**, the things the format makes possible once the reader
exists:

- **Brownfield mode.** Ingest an existing project, report standards drift,
  propose fixes.
- **Machine Expert round-trip.** Regenerate screens when the PLC symbols change,
  closing the loop the symbol-link feature opens.
- **Commissioning assistant.** Replay logged field values through the live canvas
  to reproduce a site issue at a desk.

---

## The one-line version

The format is legible, so full automation is possible; the preview is the
export, so it cannot lie; the compiler holds that rule, so it cannot rot; and a
file we wrote opens in the product today. What stands between this and an
engineer using it is not features. It is **the licensing question, a reader that
never loses what it does not understand, and a way to prove the generation is
right.** Everything else is sequencing.
