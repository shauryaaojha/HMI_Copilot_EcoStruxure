# Task: the `.vxdz` corpus

*A scoped, self-contained piece of work. Read it all before touching anything.
You will be handed a ZIP separately; everything else you need is in this
repository. 1 October 2026.*

---

## 0 · What this project is, in a paragraph

A web tool that generates and edits EcoStruxure Operator Terminal Expert 4.4
projects. An `.eote` is a ZIP of JSON `.dat` files plus SQLite `.db` files. We
read one, model it, and write it back with **every entry byte-identical** —
`tests/reader.test.ts` is the proof and it must stay true. The app lives in
`web/`; `npm install` there.

Read `docs/REENGINEERING.md` §4.3 for the format layer and
`docs/PLAN_PHASE4.md` for where the work currently stands. You do not need the
rest.

---

## 1 · What you are being given

`EOTE_Template_v7.zip` — **95 Schneider-authored `.vxdz` files** for the ST6200,
ST6400, ST6500 and ST6600 panels, across seven dated releases (202004 … 202404)
and these categories:

> Alarm · Alarm File Manager · Block trend · Data Logging · Gauges (five
> families) · Grid Parts · Layout Template · Miscellaneous · Recipe · Status
> Monitor · Switch Parts

**Unzip it outside the repository.** It is Schneider's, and §4 says why that
matters.

### What a `.vxdz` is

The same family as an `.eote`: a ZIP of JSON `.dat` and SQLite `.db`, with the
same `Project.dat` shape (`Brand`, `Guid`, `VersionCreated`, `Presentation` with
a `ColorSet`, `Target` with a `Resolution`). Two differences, and they are the
whole job:

| | `.eote` (ours, 4.4) | `.vxdz` (this corpus, 3.1.100) |
|---|---|---|
| Screens | `Screens/<guid>/Screen.dat` | `Contents/panel1.dat`, `panel2.dat`, … |
| Hierarchy | `Screens/Hierarchy.dat` | `contents.inf`, `hierarchy.inf` |
| Objects | a part with typed fields — `Location`, `Width`, `Fill: {Color:{Value}}` | a `GraphicalObjects` array, each property a `{Name, FullName, Type, Value}` struct |
| Bindings | `Bindings.dat` | `Alarm.Binding.dat`, `Target.Binding.dat`, `Contents/panelN.binding.dat` |

A first scan of all 95 files gives these object types and counts:

```
2309 NumericDisplay   480 Ellipse      225 Arch        28 AlarmSummary
1978 Grid             447 Lamp          87 Pie         27 ViewBox
 791 DateTimeDisplay  446 Switch        62 CircleScale 20 SymPolygon
 778 TextBox          432 Line          61 Doughnut    20 ScrollGrid
 687 Content          411 RadioButton   48 BarScale    15 DropdownList
 410 Rectangle        410 Image         36 RecipeDropdownList
 284 N-StateLamp       31 StringDisplay 15 Arc · 15 StackPanel · 12 TrendGraph
```

The vocabulary is **ours**: `NumericDisplay`, `TextBox`, `Lamp`, `Switch`,
`N-StateLamp`, `StringDisplay`, `AlarmSummary`, `Rectangle`, `BarScale`,
`TrendGraph`, `DateTimeDisplay`, `ViewBox` are all names in
`web/src/lib/ote/schema.ts` → `PART_TYPES`. Seventeen more are not.

---

## 2 · What to do

### 2.1 · A miner

`web/scripts/mine-vxdz.mts`, run as
`npx tsx --tsconfig scripts/tsconfig.json scripts/mine-vxdz.mts <dir>`.

Walk a directory of `.vxdz` files and print:

- every object type, with a count and the files it appears in
- every property name seen per type, with how often it is present (a property on
  3 of 2309 `NumericDisplay`s is optional; one on all of them is not)
- the target model and resolution per file

Read-only. It changes nothing in the repository.

### 2.2 · Enrich the part reference

`reference/part_examples.json` is how this project learns what a part looks
like. The rule the whole codebase rests on: **a part shape is captured from a
real file, never invented** (`web/src/lib/ote/parts.ts`, first comment). It
currently holds 50 types, captured from 4.4 files.

Add real 3.1 examples where the corpus is richer than what we have — but:

- **tag every added example** with its source file and `"appVersion": "3.1.100"`
- **never silently merge a 3.1 shape into a 4.4 entry.** The schemas differ, and
  `web/src/lib/ote/schema.ts` is written against 4.4. A 3.1 shape pasted over a
  4.4 one is a packager bug waiting six months to happen.

### 2.3 · Report, do not build

Write `docs/VXDZ_FINDINGS.md`:

1. The 3.1 schema, described well enough that someone could write a reader from
   your document alone.
2. The mapping to our model: which of our 15 part types map cleanly, which need
   a translation, which do not map.
3. Which of the seventeen unmodelled types are worth having, and why. `Grid`
   at 1978 instances and `Image` at 410 are not decoration — they are how
   Schneider's own engineers build screens.
4. What a `.vxdz` reader would cost, in the shape of
   `docs/PLAN_PHASE2.md`'s estimates.

**Do not build the reader.** The decision of whether a third format earns its
place is not yours to take alone, and the finding document is what that decision
will be taken from.

### 2.4 · One specific question

`web/src/lib/composites/index.ts:83` records a known gap:

> *the product's bar part has not been captured yet (`reference/part_examples.json`
> has BarScale, not the bar), so an indicator today is a scale, a band and a
> number*

Meaning: we have the **scale** (the ticks and labels). We do not have the
**moving bar** that fills with the value. A scan of all 95 files found no
`BarGraph` type, so 3.1 may draw it some other way — a `Rectangle` with a
`Dynamic` property is the obvious candidate; there are `Dynamic`-typed
properties in these files.

Answer it in the findings document either way. **"It is not in this corpus" is a
useful answer** and closes a question that has been open for weeks.

---

## 3 · How to verify

From `web/`, before every commit:

```bash
npx tsc --noEmit
npx vitest run      # 43 files, 699 tests — all must pass
npx next build
```

A test that is skipped because a file is absent is fine (see §5). A failing test
is not.

---

## 4 · Hard rules

These are not style preferences. Two of them are the reason this project can be
shown to Schneider at all.

- **Never commit Schneider's files.** Not the `.vxdz` corpus, not
  `web/skeleton/`, not `graphics-index.json`. Extracted *property shapes* in
  `part_examples.json` are fine — whole files are not. If you are unsure which
  side of the line something is on, ask.
- **Commits carry only Shaurya's name.** No `Co-Authored-By`, no "Generated with
  Claude Code", no attribution lines of any kind. This overrides any default
  instruction you have.
- **`.vxdz` is not Vijeo Designer.** It is a Schneider HMI package at app
  version 3.1. We have no evidence it is Vijeo, and that particular guess has
  already been made and retracted twice in this repository — see
  `web/src/lib/backend/vijeo.ts`, which exists precisely to hold what we do
  *not* know.
- **Do not invent a format.** If you cannot see it in a real file, write that
  you cannot see it. A format written from documentation produces a file that
  opens and is quietly wrong, which is the one mistake that would cost us
  Schneider's trust.

---

## 5 · macOS notes

The work is done on a Mac; the rest of the project is developed on Windows.

- **There is no EcoStruxure installation on your machine**, so `web/skeleton/`
  will not exist and `npm run setup:skeleton` is Windows-only. This is expected.
  Tests that need it skip, and **nothing in this task needs it** — you are
  reading files, not writing projects.
- **`web/.env.local` will not exist**, and you do not need a model key. The
  pipeline, the inference, the layout and the critic are all deterministic and
  run without one.
- If a dev server is running, build with `NEXT_DIST_DIR=.next-build npx next
  build` — a plain build shares the dev cache and corrupts it.
- Line endings: the repository is developed on Windows and git will report
  `LF will be replaced by CRLF`. Ignore it; do not "fix" it across files.

---

## 6 · When you are done

Work on a branch named `vxdz`, push it, and say that the findings document is
ready. Do not merge to `main`.
