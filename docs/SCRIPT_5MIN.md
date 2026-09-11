# Five-minute script

**Deck:** `docs/HMI_Copilot_5min.pptx` — 11 slides.
**Spoken words:** 595. At a calm 130 wpm that is 4 min 35 s, leaving 25 seconds
for the pauses and the demo silence the script asks for. That is tight on
purpose — if you are behind, drop the italic lines, never speed up.

Read the bold lines as written. The rest is yours. The timings are cumulative —
if you are past the mark at the end of a slide, cut the italic sentence on the
next one and carry on. Never speed up.

---

## 0:00 — Slide 1 · The hook

> Do not introduce yourself yet. Do not say "our project is". Start cold.

**"This sentence —"** *[point at the quote]* **"— produced eleven screens. Five
hundred and sixty objects. Twelve hundred and forty-eight tags, all bound."**

*(pause — let them read the numbers)*

**"Nobody placed a single object by hand."**

*(pause)*

**"And the file opens in EcoStruxure Operator Terminal Expert. It was never
saved by the product. We wrote it."**

> That last line is the whole pitch. Say it slowly, then stop. Let the silence
> sit for two seconds before you move.

**"I'm — from — . Here is how."**

**⏱ 0:25**

---

## 0:25 — Slide 2 · The problem

**"Problem statement three names four costs. An engineer hand-places every lamp
and every trend, repeats it for forty near-identical screens, then maps hundreds
of PLC symbols onto object properties one sheet at a time."**

**"But the sharp one is tag integration."** *[point at the black bar]* **"A wrong
binding is not a drawing error. It is pump two's flow displayed under pump one's
label — and you find it during an upset."**

**"That is why this is a safety problem, not just a productivity one."**

**⏱ 0:55**

---

## 0:55 — Slide 3 · Why it is possible

**"Every idea like this dies on one question: does the output actually load into
the engineering tool?"**

**"So we asked it first."**

**"We took the templates EcoStruxure itself ships and opened them up. The
project file is a ZIP of plain JSON and plain SQLite. No signature. No
encryption. Nothing to defeat."**

**"It can be written from scratch. Everything after this follows from that."**

**⏱ 1:20**

---

## 1:20 — Slides 4–7 · The demo

> **If the app is running, switch to it now and talk over the live product.**
> The slides are the fallback. Do not do both.
> Budget: 105 seconds for all four. Watch the clock here more than anywhere.

### 4 · The board (1:20)

**"Here is the plant it built. An overview, then a screen per area, with
navigation between them."**

**"Because a twelve-hundred-tag plant is not one screen. It is a hierarchy — and
inferring that hierarchy from tag names is the actual problem."**

### 5 · The build (1:50)

**"And it reports in engineering language. Not 'thinking' — parsed twelve-forty-eight
tags, inferred pumps and motors, configured two hundred and thirty-two alarms."**

**"An engineer will not accept a screen they did not see being built."**

### 6 · The bindings (2:15)

**"The binding map, drawn from the real bindings graph inside the file."**

**"Tag integration is the pain point the brief names, and today it is invisible
until commissioning. Here you can check it before you export."**

### 7 · Simulation (2:40)

**"And before any hardware exists, press Simulate."**

*[let it run — five seconds of silence, let them watch the alarms fire]*

**"Values are driven through the project's own alarm setpoints, so every alarm it
configured actually fires."**

**⏱ 3:05**

---

## 3:05 — Slide 8 · Why you can trust it

**"One thing separates this from a demo that merely looks good. The same JSON
that draws the preview is the JSON that becomes the file — there is no second
model of the screen to drift from the first."**

**"And the compiler enforces it: the canvas cannot draw a part the packager
cannot write."**

**"What the engineer approves is what EcoStruxure opens."**

**⏱ 3:35**

---

## 3:35 — Slide 9 · Proof

**"Two project files, written from scratch. Both open in EcoStruxure four-four.
Neither was ever saved by the product."**

**"Four hundred and sixty-seven tests. Fifty real part types extracted from
Schneider's own samples, not invented. And two independent packagers, Python and
TypeScript, diffed against each other — which is a stronger claim than either
passing its own tests."**

> If you are running long, cut everything after the first sentence.

**⏱ 4:05**

---

## 4:05 — Slide 10 · The business

**"System integrators pay. They work fixed-price, so time saved is margin on hours
they already quoted — and they are the only buyer guaranteed to already have the
licensed EcoStruxure install this needs."**

**"Thirty-five hundred rupees per seat per month. Against an Indian engineer's
fully-loaded cost, that seat has to give back about forty-four hours a year.
Five and a half days."**

**"Does generating your first draft and resolving your bindings save you five days
a year? That is the whole question — and it needs no savings claim."**

**⏱ 4:40**

---

## 4:40 — Slide 11 · Close

**"This does not replace the HMI engineer."**

**"It encodes the senior engineer's judgement — which part, which alarm, which
naming standard — and gives it to everyone on the team, every time."**

**"It works today, at the file boundary, with no change to Schneider's product."**

*(pause)*

**"Open the generated project on your own machine. We'll wait."**

> Stop. Do not add a summary. Do not say "so yeah". Stop talking.

**⏱ 5:00**

---

## If you have a live app, do this instead of slides 4–7

1. **New project** → **Tags** → click the water treatment sample. *(1,248 tags,
   five corrections reported — say "corrections are reported, never applied
   silently")*
2. Back to the workspace. Paste the sentence. **Enter.**
3. Talk over the run overlay while it builds.
4. When it lands: **Board** view — the eleven screens.
5. **Bindings** tab.
6. **Simulate.** Let it run in silence.

**Fallback trigger:** if generation has not started within eight seconds, say
*"we'll use the recording"* and go to the slides. Do not debug on stage.

---

## Questions you will be asked

| Question | Answer, in one breath |
|---|---|
| "Does it really open?" | "Yes. Give me a machine with OTE and I'll open it now." |
| "What if the AI gets it wrong?" | "It never auto-deploys. The engineer watches every object appear and approves before export. That is deliberate — an HMI is what an operator looks at during an upset." |
| "Is this just a wrapper on an LLM?" | "The model chooses among real parts with real properties from Schneider's own machine-readable schemas. It cannot invent a property that does not exist. And the packager is ours, proven against a Python reference." |
| "Can it edit an existing project?" | "Not yet, and that is the biggest remaining piece. It has to be built as a preservation problem — carry through everything you do not understand, byte-identical — or nobody gives you a second project." |
| "How would you ship it?" | "Per-seat desktop, running where a licensed install already is. A hosted service would mean redistributing Schneider's own database files, so the licensing question picks the architecture." |
| "Why not a plugin inside OTE?" | "A plugin is a fork with extra steps — it needs an SDK and signing, and breaks every release. The file boundary works with any 4.4 install and survives upgrades. And both layers already ship an embedded Chromium, so this interface can dock inside the tool later." |
| "Are the numbers reproducible?" | "Screens and objects vary with the model — we have seen eight, ten and eleven screens on the same prompt. What does not vary: 232 alarms, 1,248 tags, five corrections, every binding resolved, zero errors." |

---

## Before you walk on

- `npm run dev`, open `/project/demo`, leave it on the workspace.
- Import the water treatment sample once, so the parse is warm.
- Screen mirroring set to **1440 wide or more** — below that the toolbar scrolls.
- Have `demo_project/HMICopilot_PumpStation.eote` on the desktop, ready to open.
- Deck open at slide 1, presenter notes visible. Every timing above is also in
  the speaker notes of the deck itself.
