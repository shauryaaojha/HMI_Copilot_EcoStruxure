# Generating screens at the level of the real ones, with AI agents

*Written 17 September 2026. Companion to `REENGINEERING.md` (the product) and
`LLD.md` (the conversation). This is the architecture for one question:
how do we generate screens an operator would accept from a Schneider
integrator, not a hackathon demo, and what exactly do AI agents do in that.*

---

## 0 · The answer in one paragraph

A screen at that level is not drawn; it is compiled. The references all
share the same grammar (grey ground, colour only for abnormal, analogue
indicators instead of bare numbers, a process view built from symbols and
pipes, a fixed frame of header, navigation and alarm band, and a hierarchy of
overview, process, detail and diagnostic screens). None of that grammar is a
matter of taste at generation time; it is a design system, and a design
system is data plus rules. So the architecture is: a **Plant Model** that says
what the plant is, a **Standard pack** that says what good looks like, a
**composite library** that knows how to draw one analogue indicator or one
pump correctly, a **layout engine** that arranges composites by process
topology on an 8-pixel grid, and a **compiler** that turns the result into
the product's own file. AI agents sit at the five points where judgement is
needed and nowhere else: understanding a messy tag list as a plant, deciding
what belongs on which screen, choosing and labelling the composites, looking
at the rendered result and saying what is wrong, and talking to the engineer.
No agent ever emits a coordinate. That constraint is what makes the level
reachable, because every one of the failure modes we have seen (the pile of
overlapping lamps, the second plant appended to the first, the header lamp
that did not fit) was a model doing geometry.

---

## 1 · What "that level" actually is

Before designing for it, decompose it. Every reference in the last message
(the ISA overview, the Hollifield handbook, the Rockwell style guide, the
Siemens template suite, the AVEVA situational awareness library, the shipped
OTE feature demo) is the same eight properties. Each one is measurable, which
means each one can be a rule, a token or a component rather than an opinion.

| # | Property of a real screen | Where it comes from | What we have today |
|---|---|---|---|
| 1 | **Grey ground, colour means abnormal.** Background and normal equipment in two or three greys; saturated colour only for alarm priority and a handful of states | Palette tokens + a colour-use rule | Brand green header, white cards, green lamps: colour means "on", which is the opposite rule |
| 2 | **Analogue before digital.** A level is a bar with a normal band and a pointer; a flow is a bar plus a number plus a unit; trends on the overview | Composite objects | A number in a box |
| 3 | **Process topology, not a list.** Level 2 screens show equipment as symbols joined by pipes, left to right in flow order, with measurements as callouts | Plant Model connections + a topological layout | Cards in a grid, one per unit |
| 4 | **A fixed frame.** Header with area name, mode and alarm count; navigation on every screen; alarm band at the same height everywhere | Master screen | Have it (header, nav strip, alarm banner), in the wrong colours |
| 5 | **Four levels.** L1 area overview (KPIs, trends, alarm counts), L2 process, L3 equipment detail and faceplates, L4 diagnostics | Screen architecture | One level: every screen is a faceplate list |
| 6 | **Alarm coding by priority.** Shape plus colour plus number; a rationalised set, not one alarm per tag | ISA-18.2 pack | Have level alarms and a summary; no priority coding on screen |
| 7 | **Symbols with state.** Simplified 2D equipment, state shown by outline or a small indicator, never by repainting the whole symbol | Symbol library with state rules | 475 shipped graphics, Path and Pipe parts, no state rules |
| 8 | **Typography and grid.** 8-pixel grid, minimum font sizes by viewing distance, consistent spacing, units always shown | Standard rules | 8-pixel grid; no font floor; units sometimes |

The table says something important. Rows 1, 4, 6 and 8 are rules and
tokens. Rows 2 and 7 are components. Rows 3 and 5 are structure derived from
the plant. **None of the eight is "make the model draw better".** The model
is needed for the inputs to rows 3 and 5 (what is this plant, what matters on
this screen), for the labels and choices inside row 2, and for the review at
the end. That is the whole design.

---

## 2 · Why the current pipeline cannot get there by tuning

Worth being explicit, because the tempting fix is a better prompt.

- The generator's vocabulary is four primitives and flat colour. There is no
  object in the file that *is* an analogue indicator; there are six
  rectangles that the model would have to place consistently every time. It
  will not, and even when it does the inspector cannot edit "the indicator",
  only its six rectangles.
- Layout is a card grid keyed by equipment unit. It has no notion of flow, so
  it cannot produce a process view, and it puts a pump and the tank it feeds
  in whichever cells were free.
- The palette is the demo's, chosen to look lively on a slide. Real screens
  are deliberately dull, and dullness is a rule you enforce, not a style you
  ask for.
- Nothing looks at the result. A pipeline that never sees its own output
  cannot converge on quality; it can only avoid rule violations it was told
  about in advance.

So the work is in the compiler, not the prompt, and the agents are placed
around the compiler.

---

## 3 · The layers

```
   engineer ──▶ Conversation agent ──────────────────────────────────┐
                    │  ops, questions, proposals                     │
                    ▼                                                │
   tags / .xvm ─▶ [A1] Plant modeller ─▶ PLANT MODEL ─▶ [A2] Screen architect
                                              │                 │
                                              │                 ▼
                    STANDARD PACK ────────────┼──────▶  SCREEN PROGRAM (IR)
                    (tokens, rules,           │                 │
                     composite defs)          ▼                 ▼
                                        [A3] Composer ──▶ LAYOUT ENGINE ──▶ Screen JSON
                                              ▲                 │           (composites)
                                              │                 ▼
                                        [A4] Critic ◀──── RENDERER (SVG/PNG) + LINT
                                              │
                                              ▼ proposals, ghosted on the canvas
                                                                │
                                                                ▼
                                                     COMPILER ──▶ .eote (parts, .co, master screens)
```

Square brackets are agents. Everything else is deterministic and tested
without a key. The agents never call each other directly; they read and write
the two shared documents, the Plant Model and the Screen Program, and the
engineer can edit both by hand.

### 3.1 Plant Model (the input everything else needs)

`REENGINEERING.md` §3 argues for it; here is what the screen generator needs
from it, concretely.

```
Site
 └ Area "Transfer pumps"
    └ Unit "Pump set 1"
       ├ Equipment PMP_101  class Pump.Centrifugal.VSD
       │    roles: RUN=PMP_101_RUN  FLT=PMP_101_FLT  SPD=PMP_101_SPD  CMD=PMP_101_CMD
       │    ranges: SPD 0..100 %   normal 40..90
       ├ Equipment FT_101   class Instrument.Flow
       │    roles: PV=FT_101_PV   units m3/h  range 0..120  normal 30..90  alarms HI 100, HIHI 110
       └ Equipment TNK_101  class Vessel.Tank
            roles: LVL=LT_101_PV  ...
    connections:  TNK_101 ─▶ PMP_101 ─▶ FT_101 ─▶ (Area "Distribution")
```

Three things in it that the current `inferEquipment` does not produce, and
that the screen level depends on:

- **Roles, not just membership.** An analogue indicator needs to know which
  tag is the PV, which is the setpoint, what the range and normal band are.
  Roles come from tag-name patterns in the class definition, from a Control
  Expert `.xvm` DDT when there is one, and from the engineer when there is
  neither.
- **Ranges and normal bands.** A bar with no normal band is a number drawn
  sideways. Ranges come from the tag export when it carries them, from the
  class defaults when it does not, and are always shown to the engineer as
  assumptions.
- **Connections.** The process view is a graph. Connections come from naming
  conventions (suffixes and area codes), from a P&ID if one is ever ingested,
  and otherwise from one question to the engineer per unit: "what feeds
  this?". A model with no connections still gets a correct L1 and L3; only
  the L2 view degrades to grouped-by-unit, and the screen says so.

**Agent A1, the plant modeller,** turns a tag list into this. It is the one
agent that must reason over messy input, so it gets the tools (`find_tags`,
class catalogue, DDT structure when present) and produces the model as a
structured output with a confidence per equipment and per connection. Below a
threshold it asks; above it, it states the assumption in the model and moves
on. The engineer sees the model as a tree and fixes it there, which is
cheaper than fixing forty screens.

### 3.2 Standard pack (what good looks like, as data)

A pack is a versioned JSON document. The default one encodes ISA-101 and the
Hollifield conventions; a customer's style guide becomes a second pack,
ingested from their PDF by an agent and confirmed by their engineer.

```
tokens:
  palette:  ground #c8c8c8  panel #d9d9d9  line #8a8a8a  ink #1f1f1f
            normalEquipment #a6a6a6  runningOutline #4d4d4d
            alarm:  P1 #e00000  P2 #ff8c00  P3 #ffd500  P4 #b400b4
            state:  open #ffffff  closed #6e6e6e  fault (=P1)
  grid: 8   fontMin: { touch: 14, control room: 12 }   unitsAlways: true
rules:
  colour.abnormalOnly     saturated colour appears only in alarm and abnormal state tokens
  colour.noFillForNormal  a running pump is an outline change, not a green fill
  indicator.analogueFirst a measured value with a range is shown as an indicator, number secondary
  alarm.priorityShape     priority 1 square, 2 circle, 3 triangle, 4 diamond, with the number
  frame.master            header, nav and alarm band from the master screen, never per screen
  density.max             at most N indicators per L1 tile, M symbols per L2 screen
  text.fontFloor          nothing below fontMin for the panel's viewing distance
composites:               which composite serves which class role, with size variants
```

The pack is loaded into the model's cached context block once and never
restated per turn. It is also what the lint reads. So the same document tells
the agents what to aim for and tells the checker what to fail. That closure
is the single most important property of the design: **the standard is not
in the prompt, it is in the pack, and the pack is enforced.**

### 3.3 Composite library (rows 2 and 7)

A composite is our own parametric object above the product's parts. It has a
definition (props, size variants, the parts it expands to) and an instance
record in the store, so the inspector edits "the indicator's range", not six
rectangles, and regeneration after a prop change is deterministic.

The first set, by what the references show most:

| Composite | Props | Expands to |
|---|---|---|
| **AnalogIndicator** | PV tag, range, normal band, alarm limits, units, orientation | BarScale + Rectangle band + Rectangle pointer + NumericDisplay + TextBox unit + alarm marks |
| **EquipmentSymbol** | class, RUN/FLT/mode tags, size | Path from the shipped library, N-StateLamp ring for state, TextBox tag label |
| **PipeRun** | from, to, direction, state tag | Pipe with states, optional arrow Path |
| **KpiTile** | label, PV, units, trend tag, target | TextBox + NumericDisplay + TrendGraph (sparkline variant) + AnalogIndicator (small) |
| **AlarmTile** | area, priority counts | Rectangles per priority with shape tokens + NumericDisplay counts |
| **Faceplate** | equipment | The current faceplate, rebuilt from the pack: state, indicators, commands (Switch, ToggleSwitch) |
| **NavHeader / AlarmBand** | screen list, area | What `layout.ts` already makes, on pack tokens |

Expansion happens at compile time into ordinary parts, which is what the
product opens today. Phase B of the roadmap replaces expansion with OTE
compound objects (`.co`, the format `ote-compound-object-format` memory
describes), so a faceplate is a native compound the customer can open and
edit in OTE. The composite definition is the same either way; only the
compiler back end changes.

### 3.4 Screen Program (the IR between judgement and geometry)

A screen is described as a program, not as boxes. This is the document the
architect agent writes and the composer agent fills in.

```yaml
screen: L2 "Transfer pumps"          level: 2   area: Transfer pumps
frame: master.default
bands:
  kpis:      [ KpiTile FT_101 flow, KpiTile TNK_101 level, AlarmTile area ]
  process:
    graph:
      nodes: [ TNK_101 (Vessel.Tank), PMP_101, PMP_102 (Pump.Centrifugal.VSD), FT_101 (Instrument.Flow) ]
      edges: [ TNK_101 -> PMP_101, TNK_101 -> PMP_102, PMP_101 -> FT_101, PMP_102 -> FT_101, FT_101 -> out "Distribution" ]
    callouts: [ FT_101: AnalogIndicator(small) at edge, PMP_101: speed indicator beside symbol ]
  detail:    [ Faceplate PMP_101 on tap, Faceplate PMP_102 on tap ]
navigation: siblings by area, parent L1 "Site overview"
```

Nothing in it is a coordinate. The layout engine turns bands into regions,
the graph into a left-to-right layered layout (Sugiyama-style layering by
flow, then ordering to minimise crossings, then snapping to the grid), and
callouts into slots beside their anchors, using exactly the region and slot
machinery `regions.ts` already has. When the graph has no edges, the process
band falls back to unit groups, and the program records the fallback so the
critic and the engineer both know why the screen looks the way it does.

**Agent A2, the screen architect,** produces the program from the Plant
Model and the pack: how many screens, which level each is, what belongs on
each, what the navigation tree is. This is a planning task with a small
output and a large, cached input, which is the shape a model is good at. It
is also the place where "the second build appended a second plant" can never
recur, because the architect sees the existing programs and edits them.

**Agent A3, the composer,** fills one screen's program: which composite and
which size variant for each element, labels in plant language, units and
ranges from the model, what is a callout and what is a tile. It works with
the layout engine through tools (`room`, `candidates`, `fit`) and picks among
candidates the engine has already verified. It never writes a box. Its output
is validated against the composite definitions before anything is laid out.

### 3.5 Renderer, lint and the critic (the loop that produces quality)

The canvas already renders every part to SVG. Add a headless raster of that
SVG (resvg or the existing Python renderer) and the pipeline can see its own
screen. Two checkers run on it:

- **Lint** is deterministic and reads the pack: colour used outside its
  tokens, an indicator without units, a font under the floor, density over
  the limit, overlap, anything off-grid, an alarm without a priority shape.
  Each finding names an object handle. This runs on every turn, costs
  nothing, and is what CI checks on the golden corpus.
- **Agent A4, the critic,** is a vision pass over the PNG with the pack's
  checklist and the screen program as context. It answers the questions lint
  cannot: does the flow read left to right, are the callouts beside the
  things they measure, is the eye drawn to the alarm and nothing else, is
  the level 1 tile ordering sensible. It returns findings as structured
  proposals against handles, which land on the canvas as ghosts through the
  same accept-and-discard path a conversational proposal uses today. The loop
  is bounded to two passes; a screen that still fails is shown with its
  findings, not silently retried.

The critic is the only agent that looks at pixels, and it only ever
proposes. That is deliberate: a critic that could edit would be a model doing
geometry again, one step removed.

### 3.6 Conversation agent (already built) and the ops it gains

The engineer's interface stays the conversation from `LLD.md`: stable
handles, placement by region and anchor, dry run and repair, proposals. It
gains ops that address the new documents instead of only parts:
`setRole`, `connect`, `setRange` on the Plant Model; `addTile`, `moveToLevel`,
`setCallout` on a Screen Program; `applyPack`. A request like "make the
transfer pump screen look like the reference" becomes `applyPack` plus a
re-run of composer and critic on that program, and the whole thing lands as
one undo step with a report.

### 3.7 Compiler

Composites expand to parts; parts go through the packager that already
round-trips `.eote` byte-identically; the frame becomes a master screen when
Phase B lands native structures; faceplates become `.co` compounds. Nothing
in the compiler is new in kind, which is the point of putting the new ideas
above it.

---

## 4 · Where the agents are, and why exactly there

| Agent | Input | Output | Why a model, not code | Guard |
|---|---|---|---|---|
| A1 Plant modeller | tag list, DDTs, class catalogue | Plant Model with confidences | Real tag lists are inconsistent, half-documented, and follow a site convention nobody wrote down; inferring roles and connections from them is reading, not parsing | Structured output; confidence threshold asks; engineer edits the tree |
| A2 Screen architect | Plant Model, pack, existing programs | Screen Programs and navigation | "What deserves a screen and what belongs on it" is a judgement about what an operator needs, which changes by industry and site | Small output validated by schema; edits existing programs, never replaces them |
| A3 Composer | one program, pack, composite defs, layout tools | Filled program | Choosing variants, writing labels in plant language, deciding what is a callout and what is a tile | Picks only among engine-verified candidates; no coordinates in its schema |
| A4 Critic | PNG, program, pack checklist | Findings as proposals | Reading a picture for balance, direction and salience is what vision models do and rules cannot | Proposal only; two passes; every finding names a handle |
| A5 Conversation | request, history, digest | ops, questions | The engineer talks in words | Everything in `LLD.md` |

And the negative space: no agent places, sizes, colours, or picks a font.
Those are the pack and the engine. This is not caution for its own sake; it
is what makes each agent's job small enough to be reliable and cheap enough
to run on every turn, and what makes the output testable without a key.

---

## 5 · Context engineering and orchestration

- **Three cached blocks, in stability order:** the Standard pack (changes
  per customer), the Plant Model (changes when tags change), the Screen
  Program of the screen at hand (changes per turn). Each is a separate
  `cache_control` breakpoint so a turn that touches only the program pays
  only for the program. The pack and the composite definitions are also what
  the tools read, so there is one source for prompt and checker.
- **Tools over dumps.** Agents never receive the whole tag list or every
  screen; they get `find_tags`, `find_objects`, `room`, `candidates`,
  `lint`, `render`, bounded to a few calls per turn as the lookup phase is
  today.
- **Structured outputs everywhere.** Every agent output is a zod schema the
  product already uses for validation, so a drifting model degrades to a
  refusal, not a broken screen.
- **Effort by task.** The architect and the critic get the high-effort model
  with adaptive thinking; the composer runs at medium; the conversation at
  the level it has now. Provider stays a seam: Claude, Bedrock, Foundry, or
  an on-premises endpoint per `REENGINEERING.md` §4.4.
- **One transaction per turn.** Whatever chain of agents a request triggers,
  it lands as one dry run, one proposal or commit, one undo step, one report,
  exactly as edits do now. An engineer never sees a half-applied screen.
- **Determinism where it counts.** Same Plant Model, same pack, same program
  gives the same pixels. The only nondeterminism is inside the agents'
  choices, and those are captured in the program, which is why re-rendering
  an old project is stable.

---

## 6 · Evaluation: making "that level" a number

Without this the architecture is an opinion.

- **Golden corpus.** Twenty programs across the eight sample plants, each
  with an engineer-approved rendering, stored as program plus PNG.
- **Lint score.** Rule violations per screen, weighted by the pack; must be
  zero on the corpus.
- **Critic score.** The vision checklist as a rubric, scored blind on
  generated versus reference screens; track the gap.
- **Acceptance rate.** In the app, the fraction of proposals accepted
  unchanged, per agent, per turn. The architect's and the composer's rates are
  the product metric.
- **Recorded sessions**, as built in Phase 2, extended to whole builds: a
  session that starts from a tag list and ends with an exported project,
  replayed in CI against the invariants and the lint.
- **Product acceptance.** Every corpus project opened in OTE 4.4 with the
  installation, once per release; composites verified as the product draws
  them, not as the canvas does.

---

## 7 · Worked example: the transfer pump station

Input: `samples/transfer-pump-station/tags.csv`, twenty tags.

1. **A1** reads the names, recognises `PMP_101..103` as pumps with RUN, FLT
   and SPD roles, `FT_101` as a flow instrument, `LT_101`/`TNK_101` as a
   tank level, proposes `TNK_101 -> PMP_10x -> FT_101` from the suffix
   pattern with confidence 0.7, and asks one question: "Do all three pumps
   draw from TNK_101?" The engineer says yes. Ranges for FT and LT come from
   class defaults and are shown as assumptions.
2. **A2** writes two programs: an L1 "Station overview" (three KPI tiles,
   an alarm tile, a trend of flow) and an L2 "Transfer pumps" (the process
   graph above, callouts on flow and level, faceplates on tap). Navigation:
   L1 to L2 and back. It declines a third screen: "one station; a hierarchy
   over it would be padding", which is what the sample's README already says.
3. **A3** picks `EquipmentSymbol(Pump.Centrifugal, medium)` for each pump,
   `AnalogIndicator(vertical, medium)` for the tank level beside the tank
   symbol, `AnalogIndicator(horizontal, small)` as a callout on the flow
   edge, labels them "P-101", "Break tank", "Discharge flow" from the
   comments, and asks the layout engine for candidates for the callouts.
4. The **layout engine** layers the graph left to right (tank, pumps, flow,
   out), spreads the three pumps vertically, snaps to the grid, places
   callouts beside their anchors, puts the KPI band in the header region
   and the frame from the master.
5. **Lint** passes. **A4** looks at the PNG and proposes one change: the
   flow callout sits above the pipe and reads as belonging to the top pump;
   move it onto the edge after the merge. The proposal is ghosted; the
   engineer accepts.
6. The **compiler** expands the composites and writes the `.eote`. The
   screen has a grey ground, three grey pumps whose outlines darken when
   running, a level bar with a normal band, a flow bar with alarm marks and
   units, pipes in flow order, and a header with the alarm count. It is the
   reference screen, from twenty tags and one question.

---

## 8 · Roadmap in this codebase (Phase 3)

Ordered by what changes every screen at once first.

| # | Item | Done when |
|---|---|---|
| 1 | **Standard pack v1** as data: tokens, the rules in §3.2, the ISA-101 defaults; the generator and `layout.ts` read tokens instead of palette constants; lint reads the same rules | Every generated screen is grey-ground and colour-abnormal-only; `tests/pack.test.ts` proves the demo build violates zero rules |
| 2 | **Composites v1**: AnalogIndicator, EquipmentSymbol, PipeRun, KpiTile, AlarmTile; instance records in the store; inspector edits props; expansion to parts at compile; round-trip through an opened project | The faceplate is rebuilt from composites; a range change in the inspector re-expands the indicator; captured OTE screenshots match the canvas |
| 3 | **Plant Model v1** with roles, ranges and connections; A1 as a structured-output agent with the confidence-and-ask rule; the tree editable in the app | Every sample plant models with at most one question; roles cover every faceplate tag |
| 4 | **Screen Program IR and the topological layout**; A2 and A3; L1 and L2 templates | The worked example in §7 renders from the sample tag list; the transcript replays without a key |
| 5 | **Renderer to PNG, lint, and A4 the critic** as proposals on the ghosted canvas | The corpus lints clean; the critic's findings on the demo are the ones an engineer would make |
| 6 | **Evaluation** as in §6, in CI | A number per release |
| 7 | **Native back end**: composites as `.co` compounds, frame as a master screen (Phase B of the product roadmap) | A faceplate opens in OTE as a compound object |

Items 1 and 2 need no key and change the look of everything already built.
Item 3 is where Schneider's `.xvm` question from the mail matters. Items 4
and 5 are the agents proper. Nothing in the list asks a model to draw.

### Status (18 September 2026)

| # | State | Where |
|---|---|---|
| 1 | done | `lib/standard/pack.ts` (tokens and rules as data, ISA-101 on colour set 4), `lib/standard/lint.ts` (colour.abnormalOnly, text.fontFloor, layout.offGrid, density.max) run inside `validateProject`; the generator, the part constructors and the demo builder read the tokens; `lib/standard/apply.ts` brings a screen drawn without the pack onto it with a per-object diff, as a store action, an `applyPack` op and a palette command; the demo fixture was brought across with `scripts/apply-pack.mts`; `tests/pack.test.ts` |
| 1 (open) | | Off-grid positions in the generator: `ZONES` (header 44, nav 32, margin 12) are not multiples of 8, so every generated frame reports as information. Bringing the zones onto the grid touches the slot resolver's tests and the packager reference and is its own change |
| 2 | done, first three | `lib/composites/index.ts`: AnalogIndicator (scale, normal band, live value, unit), KpiTile (large value, unit, small trend), EquipmentSymbol (library symbol with running and fault indicators at the corners); instances in the store (`composites`, keyed by the group id their parts carry) with `addComposite`, `setCompositeProps` (re-expands in place, one undo step) and `registerComposite`; the inspector edits a composite's props as one form (`CompositeEditor`); the Insert menu has a Composites group; `addObject` accepts a composite kind; the generator builds every faceplate reading as an AnalogIndicator and the pipeline emits a `composite` event the client adopts; `tests/composites.test.ts` |
| 3 | done, deterministic | `lib/plant/model.ts`: Site → Area → Unit → Equipment with class, roles, a range per reading (`lib/plant/units.ts` reads units and stated ranges from comments, else class defaults marked as such), connections from the loop convention (source → mover → conditioner) with confidence, assumptions stated, and at most one question (what feeds a unit with no source), answered into engineer-confidence connections. Store actions `setPlant`, `answerQuestion`, `setRange`, `connect`, `disconnect`; the Plant page in the rail edits the tree; the pipeline builds the model, emits it, and the faceplate indicators take their ranges from it. `tests/plant.test.ts` runs every sample plant in the repository: valid, ≤1 question, every reading ranged, acyclic, every wired tag covered |
| 4 | done, deterministic | `lib/program/program.ts` (the Screen Program IR, and the architect: one process program per unit with something to connect, an L1 of headline KPIs when there is more than one), `lib/program/topology.ts` (layers by longest path, barycenter order, even spread on the grid), `lib/program/compile.ts` (frame, KPI band, symbols as EquipmentSymbol composites, pipes as elbows between them, callouts as indicators; gives up callouts, then symbol height, never the panel edge, and says which in the build log). The pipeline adds the process views after the faceplates and lists them on every strip. The worked example in §7 runs from the sample tag list in `tests/program.test.ts`, without a key |
| 4 (open) | | The agents A2 and A3: the architect and composer are deterministic; a model would decide what belongs on which screen and choose variants. The L1 KPI program is written but not yet compiled into the application (the plan's tile overview stands in). Programs are not kept in the store, only what they compiled to |
| 3 (open) | | The agent pass (A1): the modeller is naming conventions and class defaults today; a model with tools would read comments and DDTs for classes and connections the names do not carry. The `.xvm` ingest. Chat ops on the model (`setRange`, `connect`) |
| 2 (open) | | The live bar itself: the product's bar-graph part is not in `reference/part_examples.json`, so an indicator is scale, band and number until it is captured. PipeRun, AlarmTile and Faceplate as composites. Composite records do not survive an `.eote` round trip (they are ours, not the file's); an opened project's indicators come back as grouped parts |

---

## 9 · Risks, stated

- **OTE fidelity of composites.** The canvas can draw an analogue indicator
  the product renders differently. Mitigation: every composite is verified
  against a screenshot from the installation before it ships, the same
  discipline the part examples follow.
- **Connections may not exist in the data.** Then L2 degrades to unit
  groups and says so. The engineer can draw a connection in the tree in ten
  seconds; the tool must make that ten seconds, not ten minutes.
- **The critic's taste versus the customer's.** The critic reads the pack's
  checklist, not its own preferences; a customer pack changes the checklist.
- **Cost and latency.** Four agents per build is more calls than one. The
  cached blocks and the small structured outputs keep a full build in the
  tens of seconds; the conversation stays one call per turn.
- **Over-automation.** Every agent output is a proposal or a document the
  engineer can edit; the sign-off record from `REENGINEERING.md` §4.7 stays
  the gate. The tool makes the engineer faster, and it still needs one.
