# The full showcase

`DEMO.md` is the ninety-second path — the one that survives a hostile clock.
This is the other one: roughly eleven minutes, and it puts almost every visible
feature on screen in an order that builds rather than wanders.

Run it on the machine with EcoStruxure installed. Two things only work there,
and they are both worth more than everything else in the list: the 474 shipped
graphic objects, and opening the generated file in the product.

---

## Part 1 — The feature inventory

Everything a judge can actually see, by where it lives. The showcase below
touches every line marked ★.

### The frame

| | Feature |
|---|---|
| ★ | **New project** — blank canvas, empty conversation, one click |
| ★ | **Project name** — set automatically from the first request, editable inline |
| | Saved stamp, updating as autosave runs |
| ★ | **Target panel chip** — shows `1024 × 600`, and `≠ file` when the skeleton's own `Target.dat` disagrees |
| ★ | **Command palette** — `Ctrl+K`: navigation, panel sizes, theme, grid and rulers, all by name |
| ★ | **Nav rail** — six destinations with live counts; validation errors badge in red |
| ★ | **Light and dark theme** |
| | Status bar — screens · objects · tags |

### The copilot

| | Feature |
|---|---|
| ★ | **Continuous conversation** — ask, look, ask again; the project is the subject |
| ★ | **Four turn modes** — build, edit, clarify, answer |
| ★ | **Clarifying questions as buttons**, only when guessing would be guessing at intent |
| ★ | **Per-turn change list** — what that turn actually did, in engineering language |
| ★ | **Revert to here** — every turn is a version you can return to |
| ★ | **Provider badge** — `gemini` or `local`, so it never implies a model was involved when it was not |
| ★ | **Openers** — generic on a new project, the loaded sample's own prompt once tags are in |
| ★ | **"What a request needs"** — a checklist computed from the project, not a form |
| | No-tags guard, with a link straight to the import |
| ★ | Thinking shimmer, composer glow, change lines rising as they land |

### The canvas

| | Feature |
|---|---|
| ★ | **Board** — every screen side by side, pan and zoom |
| ★ | **Board / Screen toggle** |
| ★ | **Screens strip** — add, rename in place, duplicate, delete, drag to reorder |
| ★ | **Drag a screen anywhere** by its name; **Tidy** puts the grid back |
| ★ | **Double-click a frame** to fill the viewport with it; again to go back |
| ★ | **Wheel zoom, anchored at the pointer**; middle-drag, space-drag and the Hand tool pan |
| ★ | **Draw tools** — Rectangle, Text, Lamp, Numeric, Alarm summary (`R T L N A`) |
| ★ | **Marquee and shift multi-select**, eight resize handles |
| ★ | **Smart guides** — snaps to other objects' edges and centres, and shows the line that caught |
| ★ | **Align six ways, distribute** horizontally and vertically |
| ★ | **Z-order**, group, lock, hide |
| ★ | **Undo / redo**, sixty steps |
| | Copy, cut, paste, duplicate; right-click menu; rulers; grid |
| ★ | **Simulate** — tag values driving lamps, readings and the alarm grid |
| ★ | **Build timeline**, floating over the canvas; click a finished step to select what it produced |
| ★ | **Bindings tab** — the tag-to-object graph |
| ★ | **JSON tab** — the real `Screen.dat`, with the selected object highlighted |

### The inspector

| | Feature |
|---|---|
| ★ | **Properties** — generated from the part schemas, so a field exists because the format has it |
| ★ | **Geometry** — X, Y, W, H, typed |
| ★ | **Data binding** per object, with an `Unbound` badge when there is none |
| | Validation findings attached to the object |
| ★ | **Layers** — the paint order itself; drag to restack, hide, lock |
| ★ | **Library** — 474 shipped symbols, searchable, click to place |
| ★ | **Tags** — the variable table, with bound tags highlighted |

### The pages

| | Feature |
|---|---|
| ★ | **Projects** — cards carrying screens, objects, tags, alarms and the request that started it |
| ★ | **Tags** — upload `.csv` `.txt` `.xlsx`, seven committed samples, **corrections reported not applied** |
| ★ | **Standards in force** — ISA-101, ISA-5.1, IEC 61131-3 and OTE's own rules, each with the file that enforces it |
| ★ | **Validation** — findings by severity, click through to the object |
| ★ | **Export** — one zip, plus the four steps that follow it |
| ★ | **History** — every version, restorable |
| | Settings |

### Only on a machine with the product installed

| | Feature |
|---|---|
| ★ | **474 shipped graphic objects** placed on generated faceplates |
| ★ | **The exported `.eote` opening in Operator Terminal Expert 4.4** |

---

## Part 2 — The showcase, step by step

Eleven minutes. Times are the pace to aim for, not a limit.

### Before they arrive

- Dev server up, `/project/demo` loaded once so every route is compiled.
- `samples/` open in a file explorer, `beverage-plant/tags.csv` visible.
- OTE 4.4 open, no project loaded.
- Dark theme. Copilot and inspector both open.

---

### 0 · Frame the problem — 30s

> "An engineer builds HMI screens by hand: draw the object, name it, type the
> tag, repeat. A plant is a few hundred objects and a few hundred bindings, and
> every one is a chance to bind the wrong tag. We generate the project, and the
> claim is that what you see is what exports."

---

### 1 · A new project — 30s

1. **New** in the top bar.
2. Point out: blank canvas, empty conversation, name says `Untitled`.

> "Nothing pre-loaded. It does not know what this is yet — and neither does
> anyone else, because nothing has been typed."

3. `Ctrl+K` — scroll the palette, close it. Mention the theme and panel size
   live there.

---

### 2 · A real tag export — 75s

4. **Tags** in the rail → drag `samples/beverage-plant/tags.csv` onto the drop
   zone.
5. Let the summary land: **228 tags**, the type breakdown.
6. **Stop on the corrections.** Four of them, one of each kind the importer has
   to report:

```
PMP 701 RUN     -> PMP_701_RUN         only letters, digits and underscore
VLV-701-OPEN    -> VLV_701_OPEN        only letters, digits and underscore
2ND_STAGE_TEMP  -> Tag_2ND_STAGE_TEMP  a name cannot start with a digit
TIME            -> TIME_1              "TIME" is a reserved word
```

> "`TIME` is the one to look at. It is a name any engineer would write, and OTE
> rejects it because it is an IEC data type. We report every correction rather
> than applying it silently — an import that quietly fixes your names is one you
> stop trusting."

7. Scroll the tag table briefly. Mention `.xlsx`, semicolon-delimited and
   headerless files all work — there is a sample for each.

---

### 3 · One sentence, a whole application — 2m

8. Back to **Workspace**. Paste the sample's own prompt:

```
Generate the operator screens for this beverage plant - a plant overview,
then a screen for each area: raw intake, pasteurising, blending,
clean-in-place, filling and packaging, and utilities.
```

Measured, not predicted: **7 screens, 374 objects, 49 alarms, 122 bindings**,
and Gemini names them `PlantOverview`, `RawIntakeArea`, `PasteurisingArea`,
`BlendingArea`, `CIPArea`, `FillingAndPackagingArea`, `UtilitiesArea` - the
areas asked for, in the words asked for.

9. **Do not narrate while it runs.** Let the build timeline do it — it floats
   over the canvas and counts what each step produced. Point at one line:

> "Every one of those is counted from what the step actually made. Not
> 'Thinking'."

10. When it settles, the board fills with screens.
11. Note the project renamed itself in the top bar.
12. Click a finished step in the timeline — **the objects it produced select on
    the canvas.**

---

### 4 · The board — 60s

13. Zoom out to the whole board. This is the beat that needs no words for a
    second or two.

> "Tabs would show you one of these at a time. An HMI application is a set of
> displays that have to agree with each other — same header, same navigation
> strip, the alarm banner at the same height — and one-at-a-time is the single
> arrangement that makes those agreements impossible to check."

14. **Wheel-zoom toward one screen** — show it anchors under the pointer.
15. **Double-click a frame** — it fills the viewport. **Double-click again** —
    back out.
16. **Drag a frame by its name** to somewhere else. Then **Tidy**.
17. Point at the shared header and nav strip across every screen.

---

### 5 · Keep asking until it is right — 2m

18. Three follow-ups, one at a time, reading the change list after each:

```
add a low level alarm on both CIP tanks
```
```
put the batch identifier in the header
```
```
which tags are still unbound?
```

19. On the third: it answers and **changes nothing** — that is the `answer`
    mode.
20. Then a deliberately vague one:

```
fix the blending screen
```

> It asks which screen and what is wrong, as buttons. "It asks when guessing
> would be guessing at your intent. It does not ask for colours or sizes — it
> assumes, acts, and tells you what it assumed."

21. Click **revert to here** on an earlier turn. The project goes back.

---

### 6 · It is a real editor — 90s

22. Click an object. Inspector → **Properties**, then **Geometry**: type a
    number, watch it move.
23. Marquee-select three objects → **align left** → **distribute vertically**.
24. Drag one near another — **the smart guide appears and it snaps**.
25. Press `R`, draw a rectangle. `Ctrl+Z`.
26. **Layers** tab — drag a row to restack, hide one, show it again.
27. **Library** tab — search `pump`, click one, it lands on the screen.

> "That is a real `Path` part with the geometry out of the installation's own
> `.path` file — the same object you would drag off the library palette in OTE,
> not a picture of one."

28. Point at the faceplates that already carry one. **29 of them** were placed
    during generation, across twelve different kinds of machine - pumps, tanks,
    valves, a heater, blend vessels, motors, a doser, conveyors, a boiler, a
    fan, a chiller and a compressor.

> "Inference decided a PMP is a Pumps/Pump01 and a CHL is a chiller. These are
> the product's own drawings, resolved out of the installation's library, and
> they only appear on a machine that has it."

---

### 7 · One model, two renderers — 45s

29. **Bindings** tab — the tag-to-object graph.
30. **JSON** tab with an object still selected — its `UniqueId` is highlighted
    in the file.

> "This is not a preview of the export. It is the export. The canvas draws the
> same JSON the packager writes, and there is a test that fails if the two ever
> disagree."

---

### 8 · Simulate — 45s

31. **Simulate** in the toolbar.
32. Lamps change state, readings move, alarms appear in the grid and the count
    rises.

> "Driven through the project's own bindings. If a lamp is bound to the wrong
> tag, it is wrong here too — which is the point."

33. Stop.

---

### 9 · Standards, for the judges — 45s

34. **Standards** in the rail. Stay on the four cards at the top.

> "ISA-101 is why a screen holds six units and not twenty. ISA-5.1 is why
> `FT_101_PV` became pump 101's flow reading. IEC 61131-3 is the ten data types
> an import may contain. And 57 reserved words are why `TIME` was corrected."

35. Point at the **file that enforces** each one, and the live count underneath.

> "Every number on this page is read out of the code that applies the rule. The
> page cannot describe a rule the product no longer follows."

---

### 10 · Validation — 30s

36. **Validation** in the rail. Findings grouped by severity.
37. Click one — it selects the object on the canvas.

---

### 11 · Export, and open it in the product — 2m

**This is the ending. Do not rush it.**

38. **Export** in the rail. Tick all three. Generate.
39. Download the **zip**.
40. Read the four steps on the page out loud, briefly — they are also in the
    README inside the archive.
41. Unzip it.
42. **Open the `.eote` in Operator Terminal Expert 4.4.**
43. Open a screen. Open the variable list. Open the alarm table.

> "Screens, variables, alarms, bindings. Generated from a tag export and four
> sentences, and nothing in this file was drawn by hand."

---

### 12 · Scale, if there is time — 30s

44. New project → import `samples/chemical-plant/tags.csv` — **718 tags**.
45. Its whole-application prompt.
46. Let the counts land: **94 units, 21 screens, ~1,590 objects, 176 alarms.**

> "Eight areas. The planner splits rather than crowds, because that is what
> ISA-101 says, and every unit ends up on a screen."

---

## What not to walk into

Two honest edges. Know them so you steer, rather than discover them live.

**Incremental placement gets rougher the deeper you go.** Turns one and two are
laid out by the layout engine and are reliably good. From the third or fourth
edit onward the model is supplying coordinates itself, and it is working from a
flat list of boxes with no sense of the screen's regions. It will not overlap
anything and it will stay on the panel — both are enforced — but it will not be
beautifully aligned. Keep the live editing run to three or four turns, and do
the finer adjustments with the toolbar in part 6, which is a better story
anyway.

**Export only works on this machine.** The project skeleton is extracted from a
licensed OTE install and is never committed, so a deployed build answers "the
`.eote` needs a project skeleton" and offers the CSV and the report instead. If
you are showing the deployed URL, do parts 1–10 there and part 11 here. Opening
the file in the real product is a stronger ending than a download link, so this
is not a compromise.

---

## The short forms

- **90 seconds** — `DEMO.md`. Parts 3, 4 and 11.
- **5 minutes** — parts 2, 3, 4, 5, 11.
- **Question time** — parts 6, 7, 8, 9, 10 are each a self-contained answer to
  "but does it really…".
