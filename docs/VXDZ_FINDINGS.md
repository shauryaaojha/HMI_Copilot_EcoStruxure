# The `.vxdz` corpus: what is in it, and what a reader would cost

*Written 1 October 2026 against the 95 files in `EOTE_Template_v7.zip`, read
with `web/scripts/mine-vxdz.mts`. Every number here came out of that script or
out of our own reader run against the corpus; where a thing could not be seen
in a real file, it says so.*

**This document reports. It does not build.** `docs/TASK_VXDZ.md` §2.3 asks for
the finding, not the reader, because whether a third format earns its place is
not a decision to take alone.

---

## 0 · The short version

Three things, in the order they change what gets decided.

1. **The corpus is not one format. It is two**, and the brief's premise that all
   95 files are AppVersion 3.1.100 with `Contents\panelN.dat` screens is true of
   85 of them. The other ten are at 3.4.1 and later and keep their screens at
   `Screens\<guid>\Screen.dat` — **the layout `lib/ote` already models**.

2. **Those ten already open in our reader today.** `readProject` reads their
   variables, finds all their screens and carries every one through unchanged.
   What it cannot do is *model* the screens, and the reasons are four small
   value-encoding differences rather than anything structural.

3. **The bar question in `composites/index.ts:83` is answered.** The product has
   no bar-graph part. A live bar is a `Rectangle` carrying
   `Animation.FillLevel`, whose `VerticalFill` or `HorizontalFill` holds the
   value. §6 has the evidence.

The recommendation that falls out of this is in §7: **the ten typed files are
worth finishing and the eighty-five struct files are not**, at least not until
something other than this corpus asks for them.

---

## 1 · What the corpus actually is

95 files, 18,939 objects, seven dated releases from 202004 to 202404.

### 1.1 · Two layouts, decided by what the file contains

| | **struct** | **typed** |
|---|---|---|
| Files | 85 | 10 |
| AppVersion | 3.1.100 – 3.3.120 | 3.4.1 – 3.5.0 |
| `Brand` | `Schneider` (87 of 95 overall) | `Pro-face` |
| Screens at | `Contents\panelN.dat`, `Screens\panelN.dat` | `Screens\<guid>\Screen.dat` |
| Hierarchy | `contents.inf`, `hierarchy.inf` | `Screens\Hierarchy.dat` |
| An object is | `{Type, Name, Properties[], Children[]}` | a part with typed fields |
| A property is | `{Name, FullName, Type, Value}` | a key on the object |
| Bindings | inline in each property's `Value` | `Bindings.dat`, one graph |
| `Variables.db` tables | `variable_root`, `BT_SPECIFIC_TABLE_VARIABLES`, … | `Variables`, `Folders`, `ScanRates`, `VariableTypes` |
| `Alarm.db` tables | `alarm_group`, `alarm_definition`, `bool_alarm` | `AlarmGroup`, `Alarm` |
| Our reader | **fails** — `no such table: Variables` | **opens** |

The miner classifies a file on its entry names rather than on `AppVersion`, so
it is classified by what it contains. That matters: the first run of the miner
reported those ten files as having zero objects, which was not true. They are
not empty, they are modern, and the script was looking in the wrong place.

### 1.2 · Nine app versions, not one

```
3.1.100 (34)   3.2.100 (18)   3.3.0 (11)   3.3.100 (11)   3.3.50 (10)
3.4.1    (7)   3.4.100  (2)   3.5.0  (1)   3.3.120  (1)
```

`docs/TASK_VXDZ.md` §2.2 asks that added examples be tagged
`"appVersion": "3.1.100"`. That would be wrong for 61 of the 95 files, so each
example added to `reference/part_examples.json` carries the version of the file
it actually came from. Nine of the eleven are 3.4.1; one is 3.4.100 and one
3.2.100. **None of the examples added is from a 3.1.100 file**, because the
3.1.100 files are the struct layout and a struct shape is not a part shape.

### 1.3 · What the two layouts share

Both are ZIPs with **backslash entry separators**, both carry `_metadata` with
`"EncryptionInfo": null, "SignatureInfo": null`, and both keep most subsystem
databases (`Recipe.db`, `Security.db`, `Language.db`) as opaque SQLite. That is
the same family as an `.eote` and the same reason automation is possible at all.

Targets seen: 1024x600 (77), 480x272 (8), 800x480 (5), 1280x800 (5). The struct
layout names a panel only by a baseboard id (`0x14000C80`); the typed layout
names it properly (`HMIST6500`) and writes the resolution as `"1024 x 600"`.

Colour sets: 2 (92 files), 3 (2), 5 (1). Our own capture is ColorSet 4.

---

## 2 · The struct schema (3.1.100 – 3.3.120)

Enough to write a reader from. Everything below was read out of a real file.

### 2.1 · Entries

```
<project>.vxdz                 ZIP, backslash separators
 |-- _metadata                 JSON   EncryptionInfo / SignatureInfo, both null
 |-- Project.dat               JSON   see 2.2
 |-- Target.dat                JSON   panel, in a Properties[] tree
 |-- contents.inf              JSON   the Contents folder tree
 |-- hierarchy.inf             JSON   the Screens folder tree, plus nav styling
 |-- scripts.inf               JSON   the Scripts folder tree
 |-- Variables.db              SQLite variable_root, BT_SPECIFIC_TABLE_VARIABLES
 |-- Alarm.db                  SQLite alarm_group, alarm_definition, bool_alarm,
 |                                    level_alarm, state_label, alarm_state, …
 |-- Recipe.db, Security.db, Language.db, Accessory.db   SQLite, opaque
 |-- Alarm.Binding.dat, Target.Binding.dat, Recipe.Binding.dat,
 |   Variable.binding.dat      JSON   resource indexes, not a binding graph
 |-- Contents\panelN.dat       JSON   a reusable Content; root object is a Grid
 |-- Contents\panelN.binding.dat
 |-- Screens\panelN.dat        JSON   a Screen; root object is a Canvas
 |-- Screens\panelN.binding.dat
 +-- Scripts\panelN.dat        JSON   GlobalScripts
```

There is **no `Bindings.dat`** — 0 of the 85 struct files have one. §2.5 says
where the bindings are instead.

### 2.2 · `Project.dat`

```json
{
  "Brand": "Schneider",
  "Guid": "c85d4e7c-08e6-445c-8aa4-a9b45a1f0ccc",
  "VersionCreated": "3.1.0.177",
  "VersionModified": "3.1.100.241",
  "AppVersion": "3.1.100",
  "Presentation": [ { "ColorSet": { "Id": 2 } },
                    { "Theme": { "Name": "Flat" } },
                    { "MultiLanguage": { "SelectedRegionID": 0 } } ],
  "Target": [ { "Resolution": { "Width": 480, "Height": 272 } } ],
  "ProjectSettings": { "Enable": false, … }
}
```

`Presentation` and `Target` are **arrays of single-key objects**, not objects.
The modern `Project.dat` is flat (`"ColorSet": 5` as a scalar) and carries no
resolution at all — that moved to `Target.dat`.

### 2.3 · A screen document

```json
{
  "Type": "Screen",            // or "Content", or "GlobalScripts"
  "Name": "Screen1",
  "Description": "",
  "Properties": [ … ],         // ScreenID, NavigationSwitch, …
  "GraphicalObjects": { … },   // ONE root node, not an array
  "ListOperations": …
}
```

`GraphicalObjects` is a single root node — a `Canvas` in `Screens\`, a `Grid` in
`Contents\` — and the objects hang off its `Children`. The brief describes it as
an array; it is an object.

### 2.4 · An object, and a property

```json
{
  "Type": "Rectangle",
  "Name": "Rectangle5",
  "Description": "",
  "IsMovable": true, "IsRemovable": true, "IsSystem": false,
  "Properties": [
    { "Name": "Location", "FullName": "Location", "Type": "Struct",
      "Value": [
        { "Bindable": 3, "Name": "Row", "FullName": "Location.Row",
          "Type": "Int", "Value": 1 }
      ] }
  ],
  "Children": [ … ]
}
```

Every property is a `{Name, FullName, Type, Value}` record. `FullName` is the
dotted path the file itself uses, so a reader can flatten on it rather than
inventing a convention. `Type` is one of `Int`, `String`, `Bool`, `Enum`,
`Struct`, `Brush`, `Color`, `ClickTrigger`, `BoolProperty` and others; `Struct`
means `Value` is another property array. `Bindable` is a small int flag whose
meaning we did not establish — **we cannot see what distinguishes 1 from 3 in
these files**, only that both occur.

Geometry is the first thing a reader must handle and the least like ours:

- `Location` is often `{Row, Column, RowSpan, ColumnSpan}` — a **grid cell**,
  not a point. On struct Rectangles, `Location.Row` is present on 50% of
  instances and `Location.Left` on 2%.
- `Width`/`Height` are present on only 6% of struct Rectangles. Size comes from
  the parent `Grid`'s row and column definitions.

That is why `Grid` is the most common object in the corpus at 2,708 instances
(§5): in this layout a grid is not decoration, it is the layout engine.

### 2.5 · Bindings are inline

There is no binding graph. A bound property carries the binding **as its
value**:

```json
{ "Bindable": 3, "Name": "VerticalFill",
  "FullName": "Animation.FillLevel.VerticalFill",
  "Type": "Int",
  "Value": {
    "Type": "Binding", "BindingType": "Variable",
    "Source": { "VariableName": "Var2", "Property": "Value",
                "Expression": -1, "Type": "IdentifierName",
                "ObjectType": "Variable" },
    "FallbackValue": 100, "Mode": "TwoWay", "Converter": null
  } }
```

Across the 85 struct files there are **9,402 inline bindings** in seven kinds:

| `BindingType` | count | what it points at |
|---|---:|---|
| `Variable` | 7,333 | a tag in `Variables.db` |
| `LanguageTable` | 1,702 | a translated string |
| `Target` | 134 | a target/system property |
| `Expression` | 117 | a computed expression |
| `GraphicObject` | 75 | another object's property |
| `Alarm` | 28 | an alarm |
| `DataLogging` | 13 | a logging channel |

The `*.binding.dat` files are **not** this graph — they are resource indexes
(font types and similar), keyed by object name.

This is the single largest difference from our model, and it cuts both ways: a
reader has to gather bindings by walking every property of every object, and a
*writer* would have to put them back inline rather than emitting one graph.

---

## 3 · The typed layout (3.4.1 and later) is our own format

Ten files. `Screens\<guid>\Screen.dat`, `Screens\Hierarchy.dat` as
`[{ObjectId}]`, `Bindings.dat` with `Sources`/`Targets`/`Bindings`,
`Variables.db` with a `Variables` table, `Alarm.db` with `AlarmGroup` and
`Alarm`. An object is a part with typed fields:

```json
{ "Type": "Rectangle", "UniqueId": "8d511ff2-…", "Name": "Rectangel_opening_valve_1",
  "Fill": { "Color": { "Value": 40 } },
  "Border": { "Color": { "Value": 1 } },
  "Location": { "Left": 480, "Top": 80 }, "Width": 20, "Height": 40,
  "Animation": { "FillLevel": { "Enable": true, "BackColor": { "Value": 2 } } } }
```

### 3.1 · Measured against our reader

`readProject` on `HVAC_Symbol01.vxdz`: **22 variables read, 24 screens found,
24 screens carried through unchanged, 0 modelled.** Of 737 top-level parts,
**58 (8%) parse against the 4.4 union with no change at all.**

The preservation path already works. The modelling path is blocked by four
things, in order of how often each one stops a part:

| Blocking issue | hits | what it is |
|---|---:|---|
| Unmodelled `Type` | 423 | `Polygon`, `PolyLine`, `Bezier`, `GroupObject`, `Ellipse`, `Line`, `Arc` … (§5) |
| `Font.Type.Value` / `.DisplayValue` | 420 | 3.4 writes `{Type: 2, Value: 0}`; 4.4 writes `{Type: 2, Value: "0", DisplayValue: "0"}` — a number where we expect a string, and a missing field |
| `Color.Value` out of 1..60 | 260 | see §3.2 |
| `Width`/`Height` required | 69 | absent on grid-placed children |
| Root child is `Canvas` | 24 | our `Screen` requires `Children: [ViewBox]` |

None of those is structural. All five are schema work on our side.

### 3.2 · Colour has two encodings, and a flag that says which

```json
"Fill":   { "Color": { "ColorIndexEnabled": false, "Value": 1548773 } }
"Border": { "Color": { "Value": 40 } }
```

`1548773` is `0x17A1E5`, which is RGB(23, 161, 229) — **a packed colour, not an
index**. When `ColorIndexEnabled` is `false` the value is `0xRRGGBB`; otherwise
it is an index into the project's colour set. Our schema constrains
`Color.Value` to 1..60, which is right for ColorSet 4 and wrong for a project
that does not use a palette.

This is exactly the class of difference `docs/TASK_VXDZ.md` §2.2 warns about: a
3.x shape pasted into a 4.4 entry would parse as a palette index and render the
wrong colour, and nothing would fail until someone opened the file. It is why
the eleven corpus examples added to `reference/part_examples.json` sit in a
`corpus` array with a computed `parsesAs44` flag and a `differences` list,
beside the 4.4 capture rather than merged into it.

---

## 4 · Mapping to our model

Our 15 `PART_TYPES`, against both layouts.

### 4.1 · Map cleanly

`Rectangle` is the only type that parses from the corpus unchanged, and only in
the typed layout. Everything else below maps in principle — the type exists,
means the same thing, and carries the same sub-objects — but needs §3.1's
encoding work first.

| Ours | corpus (struct / typed) | note |
|---|---:|---|
| `Rectangle` | 519 / 157 | parses today; `Animation.FillLevel` is the addition (§6) |
| `TextBox` | 992 / 293 | font encoding only |
| `NumericDisplay` | 2,367 / 2,220 | font and colour encoding |
| `Switch` | 547 / 508 | font encoding; `Press`/`Release` shapes agree |
| `Lamp` | 661 / 4 | corpus example is thinner than ours; keep ours |
| `N-StateLamp` | 284 / 1 | corpus example is thinner than ours; keep ours |
| `StringDisplay` | 33 / 15 | corpus example is thinner than ours; keep ours |
| `DateTimeDisplay` | 793 / 780 | font encoding |
| `ToggleSwitch` | 2 / 20 | font encoding |
| `AlarmSummary` | 28 / 0 | struct only |
| `BarScale` | 48 / 0 | struct only; the *scale*, not the bar (§6) |
| `TrendGraph` | 13 / 1 | corpus adds every channel set |
| `BlockTrend` | 6 / 0 | struct only |

### 4.2 · Need a translation

| Ours | corpus | the translation |
|---|---|---|
| `Path` | 100 typed | corpus writes `Path: {Commands, Data}`; our schema wants `Commands` and `Points` at the top level. A rename and a split, not a redesign |
| `Pipe` | 201 typed | shape agrees, including `States[]`; blocked only by packed-RGB colour |

### 4.3 · Do not map

**The whole struct layout.** Not because any single type is impossible, but
because `Location: {Row, Column}` has no meaning on an absolute canvas until a
reader models grids — the same dependency `PLAN_PHASE2.md` already records
under "Grid containers". A struct screen is a grid of grids; reading one
without the grid model gives a pile of objects with no positions.

---

## 5 · The unmodelled types

28 type names in the corpus are outside our 15 and outside the containers.
8,078 instances between them. Ranked by what Schneider's own engineers actually
place:

| Type | struct | typed | total | worth having? |
|---|---:|---:|---:|---|
| `Grid` | 2,528 | 180 | **2,708** | **Yes, and first.** It is not decoration, it is how the struct layout positions everything. Already named in `PLAN_PHASE2.md` as a dependency |
| `Line` | 674 | 604 | **1,278** | **Yes.** Cheap — it is `Path` with two points — and a mimic diagram without lines is not a mimic diagram |
| `Ellipse` | 481 | 324 | **805** | **Yes.** Same cost as `Rectangle`; vessels and tanks are drawn with it |
| `RadioButton` | 659 | 0 | **659** | Maybe. 659 instances but concentrated in 7 files — a template style, not a general need |
| `GroupObject` | 35 | 478 | **513** | **Yes.** Already in `PLAN_PHASE2.md` Phase 3. The corpus answers the open question there: its children *are* in `Screen.dat`, nested under `Children` |
| `Image` | 424 | 42 | **466** | **Yes, with care.** Needs the bytes in `Resources\<sha1>.png`, which the corpus has. Already Phase 3 |
| `ContentDisplay` | 286 | 31 | **317** | **Yes.** It is how a screen embeds a reusable Content — the native equivalent of our composites |
| `Polygon` | 6 | 251 | **257** | **Yes.** We already hold a 4.4 capture of it; it is simply not in the union |
| `Arch`, `Pie`, `Doughnut`, `Arc`, `CircleScale` | 457 | 76 | **533** | Together. These five are the gauge vocabulary; five of the corpus's seven gauge families are built from them |
| `PolyLine`, `Bezier` | 0 | 292 | **292** | Low. Both are `Path` variants and both appear in exactly one file |
| `DockPanel`, `StackPanel`, `UniformGrid`, `ScrollGrid`, `ScrollCanvas`, `ZoomCanvas` | 100 | 37 | **137** | Only with `Grid`. They are the same layout family and share its dependency |
| `RecipeDropdownList`, `IngredientViewer`, `FileManager`, `HardwareConfiguration`, `DropdownList`, `SymPolygon`, `TimeDisplay` | 123 | 2 | **125** | No. Each is a subsystem's own control, and the subsystem is not modelled either |

The short list, if the point is to open a Schneider-authored screen and have it
look right: **`Grid`, `Line`, `Ellipse`, `Polygon`, `GroupObject`,
`ContentDisplay`, `Image`** — seven types, 6,344 of the 8,078 instances, and
97% of the top-level parts in the richest file in the corpus (§7.1).

---

## 6 · The bar graph: answered

> `web/src/lib/composites/index.ts:83` — *"the product's bar part has not been
> captured yet (`reference/part_examples.json` has BarScale, not the bar), so an
> indicator today is a scale, a band and a number"*

**There is no bar part. There never was.** No type named `BarGraph`, `Bar`,
`Level`, `Fill` or anything like them appears in any of the 95 files; the 48
type names seen are listed in §5 and §4. The brief's hypothesis — "a `Rectangle`
with a `Dynamic` property" — is close, and the real answer is more useful:

**A live bar is a `Rectangle` with `Animation.FillLevel`.**

- 105 struct objects carry `Animation.FillLevel`. **All 105 are Rectangles.**
- 15 typed objects carry it. **All 15 are Rectangles.**

```json
"Animation": { "FillLevel": {
  "Enable": true,
  "VerticalFill":   <value or binding>,
  "HorizontalFill": <value or binding>,
  "BackColor": { … }          // the unfilled remainder
} }
```

In the **struct** layout the value is an inline binding (§2.5). In the **typed**
layout the binding is a row in `Bindings.dat`, and it is the shape our own
binding graph already writes:

```json
// Sources
{ "ObjectType": 8, "SubType": "Rectangle", "ReferenceId": 162,
  "ObjectId": "29e69a84-…", "ScreenId": "ef9da631-…",
  "ObjectFullName": "Rectangel_opening_valve_3",
  "PropertyFullName": "Animation.FillLevel.VerticalFill" }

// Bindings
{ "Type": 3, "Mode": 1,
  "BindingText": "$GraphicObject.Rectangel_opening_valve_3.Animation.FillLevel.VerticalFill",
  "Target": 283, "TargetProperty": "Value", "Sources": "162" }
```

`ObjectType: 8` is `OBJECT_TYPE.PART` in `lib/ote/bindings.ts` already.

### Two things worth noticing

**We nearly had this.** Our own 4.4 capture of `Polygon` in
`reference/part_examples.json` already carries
`Animation: {FillLevel: {Enable: true, BackColor: {Transparency: 80}}}`. The
mechanism was in the repository; nothing connected it to the gap, because
`Polygon` is not in the part union and nobody was looking at it.

**The corpus has the worked example.** `GPS_Tank01.vxdz` is a tank whose level
is a `Rectangle` with `Animation.FillLevel.VerticalFill` bound to a variable —
it is the `AnalogIndicator` composite, built by Schneider, in their own
template pack. It is captured in `reference/part_examples.json` under
`Rectangle.corpus`.

### What closing the gap needs

Not a `.vxdz` reader. `Animation.FillLevel` is a 4.4 shape too, and the work is:

1. add `Animation.FillLevel` to the `Rectangle` schema (`Enable`, `BackColor`,
   `VerticalFill`, `HorizontalFill`);
2. have `AnalogIndicator` place a filled `Rectangle` between the scale and the
   band, as the comment at `composites/index.ts:83` already anticipates;
3. emit the binding row with `PropertyFullName:
   "Animation.FillLevel.VerticalFill"`.

The one thing we **cannot** see in this corpus is how the product maps a value
range onto the fill: there is no `Minimum`/`Maximum` beside `FillLevel` in any
of the 120 instances. Either the bound variable is already a percentage, or the
range lives somewhere we have not found. **That has to be checked against the
product before anything is written** — it is the difference between a bar that
fills correctly and one that is quietly wrong, which is the failure this
project cares most about avoiding.

---

## 7 · What a reader would cost

In the form `docs/PLAN_PHASE2.md` uses: the item, why it is where it is, and
the test that says it is done.

### 7.1 · The typed layout — worth doing

This is not really "a `.vxdz` reader". It is finishing the reader we have, and
every item is useful on `.eote` files too.

| # | Item | Why now | Done when |
|---|---|---|---|
| 1 | **Font reference accepts both encodings** | 420 of the blocking issues, and one of two things stopping 92% of real parts from modelling | `Font.Type.Value` parses a number or a string, `DisplayValue` is optional, and a file read then written puts back exactly what it found |
| 2 | **Colour accepts packed RGB** | 260 blocking issues. `ColorIndexEnabled: false` means `Value` is `0xRRGGBB`, and our 1..60 constraint is a ColorSet-4 assumption | `Color.Value` parses outside 1..60 when `ColorIndexEnabled` is false; the canvas renders it as a colour, not a palette lookup; a round trip is byte-identical |
| 3 | **`Canvas` as a screen root** | 24 screens, every one in the corpus | `Screen.Children` accepts `Canvas` or `ViewBox`; the canvas draws either |
| 4 | **`Width`/`Height` optional on grid-placed children** | 69 issues, and the honest modelling of an object sized by its parent | A part with no `Width` parses, and the layers panel shows it as sized by its parent rather than as 0 wide |
| 5 | **The seven types in §5's short list** | 5,967 instances. Each is one schema entry, one renderer branch and one captured example — the track `PLAN_PHASE1.md` item 7 already established | Each parses from `reference/part_examples.json`, renders, round-trips byte-identical, and `tsc` forces the canvas to draw it |

Measured on `HVAC_Symbol01.vxdz`, 737 top-level parts:

| | parts that could model | |
|---|---:|---|
| today | 58 | 8% |
| ceiling for items 1–4 | 314 | 43% |
| ceiling after item 5 | 714 | **97%** |

The ceilings are counted as "the part's `Type` is one we model" — items 1–4
remove the encoding reasons a known type fails, item 5 adds the seven types.
The last 23 parts are `PolyLine`, `DropdownList` and the long tail of §5.

**Items 1–4 are small and bounded; item 5 is the same per-part work this project
has done eleven times already.** The jump from 43% to 97% is almost entirely
`GroupObject`, which is 356 of the 737 on its own — it is the single most
valuable type in the list and it is already Phase 3 in `PLAN_PHASE2.md`.

### 7.2 · The struct layout — not worth doing yet

| What it needs | Why it is large |
|---|---|
| A second object model | `{Type, Properties[]}` with `FullName` paths, parsed into our typed parts and written back. Not a translation of ours — a parallel one |
| A grid layout model | `Location: {Row, Column}` into absolute pixels, which needs the parent `Grid`'s row and column definitions. `PLAN_PHASE2.md` already names this as unstarted |
| Inline binding extraction | 9,402 bindings in 7 kinds, gathered by walking every property of every object, and written back inline rather than as a graph |
| A second database schema | `variable_root` and `BT_SPECIFIC_TABLE_VARIABLES` instead of `Variables`; `alarm_definition` and `bool_alarm` instead of `Alarm` |
| A second packager | Round-trip safety is the gate (`REENGINEERING.md` §4.3), and it would have to hold for a format with none of our writer's assumptions |

Each of those is comparable to a phase of work already done for 4.4, and none of
it makes an `.eote` better. The one cheap thing worth taking from the struct
files is what they document — which is this file.

### 7.3 · The recommendation

**Do 7.1. Do not do 7.2 on the strength of this corpus.**

Reasons, in order:

1. **7.1 is not a third format.** Items 1–4 are corrections to assumptions our
   schema made from a single source file (`Demo 1.eote`, ColorSet 4), and they
   make the 4.4 reader more correct whether or not a `.vxdz` is ever opened.
2. **The corpus's own direction is towards us.** The ten newest files, 3.4.1 to
   3.5.0, are in our layout. The struct layout is what Schneider was writing in
   2019 and has moved off.
3. **Nobody has asked for it.** The one question this corpus was opened to
   answer — the bar — is answered, and answered without a reader.
4. **If it is ever needed, it will be needed for a customer's project, not a
   template pack**, and that project will say which of the 85 files' features
   actually matter. Building against the template pack would be building against
   a guess.

What would change this: a real customer project at 3.1–3.3 that someone wants
opened. Then §2 is the specification to build from, and it is complete enough
to start.

---

## 8 · What we could not see

Written down rather than guessed, per `docs/TASK_VXDZ.md` §4.

- **`Bindable`.** A small int on many properties, values 1 and 3 observed. What
  distinguishes them is not visible in these files.
- **The fill range for `Animation.FillLevel`.** No `Minimum`/`Maximum` beside it
  in any of the 120 instances (§6).
- **`Options`.** An int on containers (104, 108, …). Plainly a bit field; the
  bits are not derivable from the corpus.
- **The baseboard ids.** `0x04000C80`, `0x0C000C80`, `0x14000C80`, `0x1C000C80`
  sort with resolution, so they encode the panel, but the mapping to a model
  name only exists in the typed files' `TargetInfo.RuntimeModel`.
- **Two `.zip` files in `202404\Grid Parts`** (`GPC_Sound01.zip`,
  `GPC_Sound02.zip`) are not `.vxdz` and were not read.
- **Whether any of this is Vijeo Designer.** It is not claimed. `Project.dat`
  says `Brand: Schneider` or `Brand: Pro-face` and `AppVersion: 3.x`;
  `web/src/lib/backend/vijeo.ts` records `.zdat` for Vijeo from separate
  research, and nothing in this corpus confirms or contradicts it.

---

## Appendix · Reproducing this

```bash
cd web
npx tsx --tsconfig scripts/tsconfig.json scripts/mine-vxdz.mts <dir>
npx tsx --tsconfig scripts/tsconfig.json scripts/mine-vxdz.mts <dir> --type Grid
npx tsx --tsconfig scripts/tsconfig.json scripts/mine-vxdz.mts <dir> --json out.json
```

`<dir>` is a directory of `.vxdz` files **outside this repository**. The corpus
is Schneider's: it is not committed, and neither is any file extracted from it.
What is committed is the shapes, in `reference/part_examples.json` under
`corpus`, each tagged with the file and the app version it came from.
