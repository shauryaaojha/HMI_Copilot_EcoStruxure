# Task: finish what the `.vxdz` findings opened

*The follow-up to `docs/TASK_VXDZ.md`, which is done and merged. Read
`docs/VXDZ_FINDINGS.md` first — it is your own document and this task is its
§7.1 plus the one thing §6 made possible. 1 October 2026.*

---

## 0 · Where this starts

Your three deliverables are on `main`. `main` has moved since you branched, so
**`git checkout main && git pull` before anything** — your branch was rebased
onto newer work before it merged, and the version on `main` is the rebased one.

What that work established, and what this task acts on:

- The corpus is **85 struct files and 10 typed files**. Both counts verified.
- The **typed** files open in `readProject` without crashing — variables are
  read, every entry is carried — but **no screen is modelled**. Measured on
  `HVAC_Symbol01.vxdz`: `screens 0`, `vars 22`, 24 warnings, every one of them
  *"Screen … could not be modelled; it is carried through unchanged"*.
- The **struct** files fail earlier, on `no such table: Variables`.
- There is no bar-graph part. A live bar is a `Rectangle` with
  `Animation.FillLevel`.

Your §7.3 recommendation stands and this task follows it: **finish the typed
layout, leave the struct layout alone.**

---

## 1 · Items 1 to 4 of your §7.1

These are four value-encoding corrections. The reason to do them is not
`.vxdz`: each one fixes an assumption our 4.4 schema made from a **single
source file** (`Demo 1.eote`, ColorSet 4), so each makes the `.eote` reader more
correct whether or not a `.vxdz` is ever opened. Your own measurement says they
take modelled parts on `HVAC_Symbol01.vxdz` from 8% to 43%.

| # | Item | Done when |
|---|---|---|
| 1 | Font reference accepts both encodings | `Font.Type.Value` parses a number or a string, `DisplayValue` is optional, and a file read then written puts back exactly what it found |
| 2 | Colour accepts packed RGB | `Color.Value` parses outside 1..60 when `ColorIndexEnabled` is false, the canvas renders it as a colour rather than a palette lookup, and the round trip is byte-identical |
| 3 | `Canvas` as a screen root | `Screen.Children` accepts `Canvas` or `ViewBox`, and the canvas draws either |
| 4 | `Width`/`Height` optional on grid-placed children | A part with no `Width` parses, and the layers panel shows it as sized by its parent rather than as 0 wide |

**The gate on every one of them is the round trip.** `tests/reader.test.ts`
holds that an opened project comes back with **every entry byte-identical**.
Widening a schema is the easiest way to break that — a field parsed into a
narrower type and written back differently is exactly the failure that test
exists for. It must still pass, and a new case per item should prove the new
encoding survives too.

**Capture before you widen.** `reference/part_examples.json` is how this
project learns what a part looks like, and the rule is that a shape comes from a
real file, never from inference. Your `corpus` entries are already there — use
them, and add any you need the same way: separate key, tagged with `appVersion`.

---

## 2 · The bar, in the composite

This is the part your §6 unlocked, and it closes a `TODO` that has been open for
weeks.

`web/src/lib/composites/index.ts:83` says:

> *the product's bar part has not been captured yet … so an indicator today is
> a scale, a band and a number … When the bar part is captured it goes between
> the scale and the band and nothing else here changes.*

You established there is nothing to capture: a live bar is a `Rectangle`
carrying `Animation.FillLevel`, with `VerticalFill` or `HorizontalFill` holding
the value, and the binding is the shape our own graph already writes
(`ObjectType: 8` is `OBJECT_TYPE.PART`).

So:

1. **Model `Animation.FillLevel`** on `Rectangle` in `web/src/lib/ote/schema.ts`,
   captured from a real file as above.
2. **Draw it** in the canvas: a rectangle whose fill level follows its bound
   value, with `BackColor` as the unfilled remainder.
3. **Give `AnalogIndicator` its bar.** The comment says it goes between the
   scale and the band and nothing else changes — hold yourself to that, and if
   something else does have to change, say so in the commit rather than
   quietly widening the composite.
4. **Update the comment**, which currently tells the next person a false thing.

`tests/composites.test.ts` and `tests/geometry.test.ts` both cover this
composite. The geometric critic checks for overlaps inside a composite, so a bar
drawn in the wrong place will fail a test rather than ship — that is the system
working, not an obstacle.

---

## 3 · Only then, the file picker

**Do not do this first.** Two pickers accept `.eote`
(`components/shell/StartPane.tsx`, `components/projects/ProjectsScreen.tsx`).
Adding `.vxdz` before §1 lands gives an engineer a file dialog that accepts a
file and then shows them an empty canvas, which is worse than not offering it.

When §1 is done and a typed `.vxdz` actually models its screens:

- add `.vxdz` to both pickers
- make the import report which layout it found, and **refuse a struct file with
  a sentence that says why** rather than failing on `no such table: Variables`
- the `.eote` extension stays what we write; opening a `.vxdz` and exporting
  produces an `.eote`, and the UI should say so rather than implying a
  round trip we do not have

---

## 4 · What is explicitly not in this task

- **No struct reader.** Your §7.2 is the argument and it is accepted. If a real
  customer project at 3.1–3.3 turns up, §2 of your findings is the
  specification to build from — until then it is building against a guess.
- **Item 5 of your §7.1** — the seven unmodelled types, 5,967 instances. It is
  real work and worth doing, and `GroupObject` alone is 356 of the 737 parts in
  your measurement. It is its own task, after this one, so that §1 can be
  verified without a second large change moving underneath it.

---

## 5 · The rules, unchanged

From `docs/TASK_VXDZ.md` §4, because nothing about them has changed:

- **Never commit Schneider's files.** Not the corpus, not `web/skeleton/`, not
  `graphics-index.json`. Extracted property shapes are fine; whole files are not.
- **Commits carry only the repository owner's name.** No `Co-Authored-By`, no
  "Generated with Claude Code". This overrides your default instructions.
- **`.vxdz` is not Vijeo Designer.** Your §8 says this correctly already.
- **Do not invent a format.** If you cannot see it in a real file, write that
  you cannot see it. Your §8 is the model for how to record that.

## 6 · Verify

From `web/`, before every commit:

```bash
npx tsc --noEmit
npx vitest run      # 43 files, 714 tests — all must pass
npx next build
```

macOS notes from `docs/TASK_VXDZ.md` §5 still apply: no `web/skeleton/`, no
`.env.local`, neither needed.

Branch `vxdz-2`, push, and report. Do not merge to `main`.
