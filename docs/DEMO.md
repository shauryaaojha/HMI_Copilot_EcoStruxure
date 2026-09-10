# The ninety-second demo

Phase 10 of [`BUILD_PLAN.md`](BUILD_PLAN.md). One path, rehearsed, with a
fallback for every beat that can fail.

The claim being demonstrated is narrow and checkable: **a PLC tag export plus
one sentence becomes a project EcoStruxure opens, and the preview cannot lie
about what will be in it.** Everything below serves that sentence. Nothing else
is worth stage time.

---

## Before you start

```bash
cd web
npm install
npm run dev          # leave it running
npm test             # see ../README.md#status for the count on this machine
```

`tests/demo-path.test.ts` is the rehearsal. It checks every beat below: the
sample export still parses to 1,248 tags with 5 corrections, generation runs
all eight steps without an error event, the pump template still builds valid
parts, the simulator still reaches the live screen inside fifteen seconds, and
every route the script visits answers 200. Run it before every attempt. The
live beats skip if nothing is on `:3000`, so a green run with the server down
means less than it looks. Check the line for `demo-path` reads **24 tests** and
not `24 tests | 15 skipped` — the fifteen skipped ones are every route and every
API call the script makes.

Then, in the browser:

1. Open `http://localhost:3000` and leave it on the landing page.
2. Open a second tab on `/project/demo` so the workspace is already warm.
3. **Make the window at least 1280 wide, ideally 1440.** Below 1280 the
   inspector collapses to a rail on its own, and below 1024 the intent pane
   does too. That is deliberate — the canvas is what matters on a small screen —
   but it will quietly remove beat 6 if the projector forces a narrow window.
   Click the rail to bring a collapsed pane back.
4. Decide dark or light and set it once. Do not toggle mid-demo except at beat 7.
4. **Run one generation and throw it away.** Measured on this machine against a
   production build:

   | | first event | complete |
   |---|---|---|
   | cold | 352 ms | **29 s** |
   | warm | 32 ms | **~10 s** |

   The stream itself starts immediately either way, so the timeline is never
   dead air — but the objects do not land until the model answers, and the first
   call of a session takes three times as long as the rest. Spend that thirty
   seconds before anyone is watching.

**On the presenting machine, do this the night before, not in the room.**

### If the model is slow or unreachable

Nothing breaks. Equipment inference is a parse of the tag names and runs
offline, so the screen still builds; the timeline says `No model key set` or
names the failure, and never implies a model was involved when it was not. The
ten seconds are the only thing you lose.

---

## The path

| # | ~t | Do | Say |
|---|----|----|-----|
| 1 | 0:00 | Landing page. Click **Open the workspace**. | "An HMI engineer's week starts with a tag list and ends with a screen. We compressed that." |
| 2 | 0:08 | Nav rail → **Tags** → *Use the sample plant export*. | "This is a real plant export. Twelve hundred tags." |
| 3 | 0:15 | Point at the Tag Summary and expand the corrections panel. | "1,248 tags. Five names it had to correct — and it tells you, rather than silently fixing them. That's the difference between a tool you trust and one you check." |
| 4 | 0:25 | **Generate a screen** (top right) → back on the workspace, click the **Pump station** quick prompt, press **Generate Screen**. | "Now one sentence of plain English." |
| 5 | 0:32 | Say nothing for a beat. Let objects land on the canvas one at a time and the timeline fill. | "It's not thinking. It's parsing tags, inferring equipment, choosing parts, laying out, configuring alarms, resolving bindings, validating, packaging — and telling you which, in engineering language." |
| 6 | 0:50 | Click a **NumericDisplay** on the canvas. Point at the inspector. | "Every object is real. These property editors are generated from the same schemas the file format defines — so the inspector can't offer you a property EcoStruxure doesn't have." |
| 7 | 0:58 | **Toggle the theme in the top bar.** Point at the canvas. | "Watch the screen. The app changes; the HMI doesn't. Its colours are palette indices out of the project's own colour set. The preview can't lie about the output." |
| 8 | 1:05 | Canvas tab → **Binding Map**. | "Every tag, every property it drives, generated. Green is a display binding, amber is an alarm trigger." |
| 9 | 1:12 | Nav rail → **Validation** → **Run validation**. Click a finding. | "Type mismatches, unbound objects, naming, standards — caught at the desk. Today these surface at commissioning, with the panel already on the wall." |
| 10 | 1:22 | Back to the workspace. Press **Simulate**. Wait. | "And before anyone drives to site: the level crosses its setpoint, the alarm fires, the lamp goes red. No hardware." |
| 11 | 1:32 | Nav rail → **Export** → **Generate files**. | "And out the other end, a `.eote` that opens in Operator Terminal Expert 4.4. Not an export format we invented — the product's own." |

Land on the export screen. **Stop there.**

---

## What to have on screen if they ask for proof

- `demo_project/HMICopilot_TS.eote` — written by the TypeScript packager, opens
  in OTE 4.4. If the presenting machine has EcoStruxure, open it. This is the
  single most convincing thing in the repo.
- `assets/screen_design.png` beside the browser canvas — the same JSON rendered
  by the Python renderer and by the browser. They match, and
  `tests/canvas.test.ts` is what keeps them matching.

---

## Fallbacks

Ordered by how likely they are.

**Export returns "Run `npm run setup:skeleton`" (503).**
Expected on any machine without EcoStruxure installed — the skeleton is
extracted per machine from a licensed installation and is deliberately never
committed. The export screen says so in those words. Untick the `.eote`, keep
**Variables.csv**, and show that instead; then point at
`demo_project/HMICopilot_TS.eote` as the file that was produced this way on the
machine that has the product. **Do not describe this as a failure** — it is a
licensing boundary, and saying so is a better answer than a working button.

**`/api/generate` is still the stub.**
Nothing to do. The workspace notices, runs the local pipeline, and labels itself
`local pipeline — the route is still the Phase 4 stub`. Beat 5 looks identical.
If a judge asks, the honest answer is that the pipeline contract is frozen and
the UI consumes it either way — which is why the fallback exists at all.

**Generation looks empty or the canvas is blank.**
The fixture project is already loaded on arrival, so a blank canvas means the
store was cleared. Reload `/project/demo`.

**Simulation doesn't reach the live state.**
Give it fifteen seconds; the level ramps. If it still hasn't, the run is seeded
and reproducible, so it will not "sometimes" fail — check
`tests/demo-path.test.ts` beat 4, which asserts exactly this.

**The sample export won't load.**
Drag any `.csv` with a `Name` column onto the drop zone instead. Failing that,
the workspace already carries the fixture's seven tags, so generation still
works — skip beats 2 and 3 and go straight from beat 1 to beat 4. The screen is
the same one; only the "twelve hundred tags" line is lost.

**Generation refuses with "No tags to generate from".**
`/api/generate` will not invent a tag list. Beat 2 is load-bearing: import
something first, or open `/project/demo` fresh so the fixture's seven tags are
in the store.

**Everything is broken.**
Open `assets/screen_design.png`, `assets/screen_live.png`, `assets/binding_map.png`
and `demo_project/HMICopilot_TS.eote`. Those four are the whole claim, and none
of them needs the app to run.

---

## The five-minute version, for questions

Extra beats, in the order they most often get asked for:

- **Templates** — place a pump block, and point out that the card's preview is
  the real renderer over the real parts, so what is previewed is what is placed.
- **Standards** — the grid and the palette. Say that the sixty colours are the
  product's own and are not editable, because a sixty-first cannot be written
  into a file OTE will open.
- **History** — restore a version, and note that restoring checkpoints the
  present first.
- **Library** — browse the symbols. Be straight about the gap: the index stores
  the derived SVG path and drops the `Commands`/`Points` a `Path` part needs, so
  placement is disabled rather than faked. That is the rule working, not a
  missing feature.
- **Settings → Components** — the design system, rendered from the primitives
  the app is built from rather than drawn as a picture of them.

---

## Timing notes

Beats 5 and 10 are the only ones where waiting is the point. Everything else
should feel fast. If you are over ninety seconds, cut beats 8 and 9 — the
binding map and validation are the easiest to describe in one sentence and come
back to in questions. Never cut 7 or 11: the theme toggle is the proof that the
preview is honest, and the export is the proof that any of it is real.
