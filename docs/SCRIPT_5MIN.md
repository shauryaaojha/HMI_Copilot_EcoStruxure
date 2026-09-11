# Five-minute script

**Deck:** `docs/HMI_Copilot_5min.pptx` — 12 slides.
**Spoken words:** ~600 — about 4 min 35 s at a calm 130 wpm, leaving 25 seconds
for the pauses and demo silence the script asks for.

Read the bold lines as written. Timings are cumulative. If you are past the mark
at the end of a slide, drop the italic sentence on the next one. Never speed up.

**Order:** hook → problem → solution → file structure → architecture → demo ×4 →
proof → business → close.

---

## 0:00 — Slide 1 · Hook

> Do not introduce yourself yet. Start cold.

**"This sentence —"** *[point at the quote]* **"— produced eleven screens. Five
hundred and sixty objects. Twelve hundred and forty-eight tags, all bound."**

*(pause)*

**"Nobody placed a single object by hand."**

*(pause)*

**"And the file opens in EcoStruxure Operator Terminal Expert. It was never
saved by the product. We wrote it."**

> Two seconds of silence. That line is the whole pitch.

**⏱ 0:20**

---

## 0:20 — Slide 2 · The problem

**"Problem statement three names four costs. An engineer hand-places every lamp
and every trend, repeats it for forty near-identical screens, then maps hundreds
of PLC symbols onto object properties one sheet at a time."**

**"But the sharp one is tag integration."** *[point at the black bar]* **"A wrong
binding is not a drawing error. It is pump two's flow under pump one's label —
and you find it during an upset."**

**"That makes this a safety problem, not just a productivity one."**

**⏱ 0:50**

---

## 0:50 — Slide 3 · The solution

**"So: a PLC tag export, one sentence of plain English, and your company
standards go in. A complete EcoStruxure project comes out — screens drawn, tags
declared, alarms configured, bindings wired."**

**"One file. File, Open Project, and the HMI is there. Nothing to import,
nothing to assemble."**

**"And the engineer is in the loop by design. The AI proposes, the canvas makes
the proposal legible, a human accepts or redirects. It never deploys anything
itself."**

**⏱ 1:15**

---

## 1:15 — Slide 4 · The project file

**"Every idea like this dies on one question: does the output actually load into
the engineering tool? So we asked it first."**

**"The project file is a ZIP of plain JSON and plain SQLite. No signature. No
encryption. Nothing to defeat."**

*"Bindings are declarative — wiring a tag to a display is one JSON object. And
the geometry maps one-to-one onto SVG."*

**"That last property is what lets one model drive both the preview and the
file."**

**⏱ 1:40**

---

## 1:40 — Slide 5 · System architecture

> The longest non-demo slide. Trace the diagram once, left to right.

**"Eight stages. Tags come in and get normalised. Equipment inference clusters
them — pump one-oh-one's run bit, fault and speed become one pump. The layout
planner places it, the screen generator emits JSON constrained by Schneider's
own schemas, and the binding resolver wires every tag."**

**"Validation runs seven rule families, then the packager writes the .eote."**

**"The client sees all of it streaming — one finished object at a time, over
server-sent events."**

*(beat)*

**"And here is the part that matters."** *[point at the green line]* **"The same
JSON drives the canvas and the packager. There is no second model of the screen
to drift from the first — and the compiler enforces it. The canvas cannot draw a
part the packager cannot write."**

**"What the engineer approves is what EcoStruxure opens."**

**⏱ 2:15**

---

## 2:15 — Slides 6–9 · The demo

> **If the app is running, switch to it now.** The slides are the fallback.
> Do not do both. 100 seconds for all four — watch the clock here.

### 6 · The result (2:15)

**"Here is the plant it built. An overview, then a screen per area, with
navigation between them."**

**"Because a twelve-hundred-tag plant is not one screen. It is a hierarchy — and
inferring that hierarchy from tag names is the actual problem."**

### 7 · The pipeline running (2:40)

**"And it reports in engineering language. Not 'thinking' — parsed
twelve-forty-eight tags, inferred pumps and motors, configured two hundred and
thirty-two alarms."**

**"An engineer will not accept a screen they did not see being built."**

### 8 · The bindings (3:02)

**"The binding map, drawn from the real bindings graph inside the file."**

**"Tag integration is the pain point the brief names, and today it is invisible
until commissioning. Here you check it before you export."**

### 9 · Simulation (3:24)

**"And before any hardware exists, press Simulate."**

*[let it run — five seconds of silence, watch the alarms fire]*

**"Values are driven through the project's own alarm setpoints, so every alarm it
configured actually fires."**

**⏱ 3:46**

---

## 3:46 — Slide 10 · Proof

**"Two project files, written from scratch. Both open in EcoStruxure four-four.
Neither was ever saved by the product."**

**"Four hundred and sixty-seven tests. Fifty real part types extracted from
Schneider's own samples, not invented. And two independent packagers, Python and
TypeScript, diffed against each other — a stronger claim than either passing its
own tests."**

> Running long? Cut everything after the first sentence.

**⏱ 4:10**

---

## 4:10 — Slide 11 · Business proposal

**"System integrators pay. They work fixed-price, so time saved is margin on
hours they already quoted — and they are the only buyer guaranteed to already
have the licensed EcoStruxure install this needs."**

**"Thirty-five hundred rupees per seat per month. Against an Indian engineer's
fully-loaded cost, that seat has to give back about forty-four hours a year.
Five and a half days."**

**"Does generating your first draft and resolving your bindings save you five
days a year? That is the whole question — and it needs no savings claim."**

**⏱ 4:45**

---

## 4:45 — Slide 12 · Close

**"This does not replace the HMI engineer."**

**"It encodes the senior engineer's judgement — which part, which alarm, which
naming standard — and gives it to everyone on the team, every time."**

**"It works today, at the file boundary, with no change to Schneider's product."**

*(pause)*

**"Open the generated project on your own machine. We'll wait."**

> Stop. Do not add a summary.

**⏱ 5:00**

---

## Live demo, instead of slides 6–9

1. **New project** → **Tags** → water treatment sample. *(1,248 tags, five
   corrections — say "corrections are reported, never applied silently")*
2. Workspace → paste the sentence → **Enter**.
3. Talk over the run overlay.
4. **Board** view — the screens.
5. **Bindings** tab.
6. **Simulate.** Silence.

**Fallback:** if generation has not started in eight seconds, say *"we'll use the
recording"* and go to slides. Do not debug on stage.

---

## Questions you will be asked

| Question | Answer, in one breath |
|---|---|
| "Does it really open?" | "Yes. Give me a machine with OTE and I'll open it now." |
| "What if the AI gets it wrong?" | "It never auto-deploys. The engineer watches every object appear and approves before export. An HMI is what an operator looks at during an upset." |
| "Is this just an LLM wrapper?" | "The model chooses among real parts with real properties from Schneider's own machine-readable schemas — it cannot invent a property that doesn't exist. The packager is ours, proven against a Python reference." |
| "Can it edit an existing project?" | "Not yet, and that's the biggest remaining piece. It has to be built as a preservation problem — carry through everything you don't understand, byte-identical — or nobody gives you a second project." |
| "How would you ship it?" | "Per-seat desktop, running where a licensed install already is. A hosted service would mean redistributing Schneider's own database files, so the licensing question picks the architecture." |
| "Why not a plugin inside OTE?" | "A plugin is a fork with extra steps — needs an SDK and signing, breaks every release. The file boundary works with any 4.4 install. And both layers already ship an embedded Chromium, so this can dock inside the tool later." |
| "Are the numbers reproducible?" | "Screens and objects vary with the model — we've seen eight, ten and eleven on the same prompt. What doesn't vary: 232 alarms, 1,248 tags, five corrections, every binding resolved, zero errors." |

---

## Before you walk on

- `npm run dev`, open `/project/demo`, leave it on the workspace.
- Import the water treatment sample once so the parse is warm.
- Mirror at **1440 wide or more** — below that the canvas toolbar scrolls.
- `demo_project/HMICopilot_PumpStation.eote` on the desktop, ready to open.
- Presenter notes on: every timing above is also in the deck's speaker notes.
