# Import fidelity: can an imported file be opened, drawn, edited and saved?

*Audit 2026-11, Part 2. Branch `audit/2026-11` at `5fd701d`. Measured by
`web/scripts/audit/fidelity.mts`. Nothing in this file is an estimate.*

Engineer projects are named by file name only. This file holds part types, panel
models, driver products, counts and percentages. It holds no screen names, tag
names or texts.

## How it was measured

```
cd web && MONGODB_URI= npx tsx --tsconfig scripts/tsconfig.json scripts/audit/fidelity.mts
```

The script runs in 100 s on this laptop. It prints a JSON summary. It writes the
full result, per file, per op and per error, to the audit scratchpad as
`fidelity-results.json`, never into the repository. Stage 2 re-runs it to
compare. It writes the PNG renders to the scratchpad too.

The script takes every `.eote`, `.vxdz` and `.co` file on the machine:

- tracked: `git ls-files`;
- gitignored: `demo_project/*.eote`, `auto&manua.eote` and `samples/**/*.eote`.

The corpus is 15 files: 4 `.co`, 6 tracked `.eote` and 5 gitignored `.eote`.
`auto&manua.eote` and `samples/hmi-panel-1/auto-manual.eote` are byte-identical.
The script counts that file once in the per-type table. No `.vxdz` or `.vdz` is
on this machine. `web/.imports/` holds 37 stored uploads, and every one is
byte-identical to a tracked file, so the script leaves them out.

The script runs five steps on each file. Each step uses the app's own code:

1. **Read.** It reads the file with `readProject`, `readStructProject` or `readCo`,
   the functions the import route calls.
2. **List.** It lists the screens, the content screens, the screens the reader
   carried whole (with their reason), and every object under each screen root by
   type. It splits those objects into modelled (editable) and carried (kept,
   but not editable). It also lists the panel model and resolution from
   `Target.dat`, the drivers from `DriverConfig.db` (manufacturer and product
   only), and the variables by data type.
3. **Draw.** It draws each modelled screen with `screenToPng`, the server
   rasteriser that `render_screen` calls, with the same arguments the agent tool
   passes (`lib/agent/tools.ts:616`). It also draws every part alone on its
   screen. A part "drew" when its SVG differs from the empty screen.
4. **Edit.** It applies one op of each kind: `moveObject`, `resizeObject`,
   `setText`, `setColor`, `addObject` and `deleteObject`.
   - Each op runs through `core/ops` `dryRun` and `commit`, the path `useChat`
     uses.
   - Each op runs on a fresh store, hydrated from the import route's JSON answer
     exactly as `StartPane.openProject` does it.
   - Each op hits one instance of each part type the file holds.
   - The script adds every part type `buildPart` can make on the first screen.
     It places each by region first, and retries at typed coordinates if the
     slot resolver refuses.
   - An op counts as "took edit" when the app applied it. It also counts as
     "visible" when the part's own drawing changed.
5. **Write and read again.** Each op gets its own export, so a fault belongs to
   that op.
   - The export follows the export route's own steps: `packageInputOf`, then
     `preflight` and `unsupportedParts` (the route's 422 and 409 gates), then
     `OTE.write` (with `nativise`, into a fresh read of the original), then
     `selfCheck`.
   - It reads the output again and diffs it against the store's model of the
     project. The edited part must match the store. Every other modelled part,
     every carried object, every unedited `Screen.dat`, every entry outside
     screens, bindings and databases, and every `Bindings.dat` row the edit did
     not remove must come back unchanged. No binding may target a part that is
     gone.

The script records "survived (writer)" and "the export route accepts"
separately. Before a user can download a file, both must hold.

## Headline numbers

The overall numbers are weighted by how often each part type appears in the
engineer projects: 591 objects, counted once per distinct file.

| | Read | Drew | Took the edit | Survived the round trip (writer) | Survived, and the export route lets it out |
|---|---|---|---|---|---|
| Weighted by type frequency in the real projects | **98.4 %** | **99.3 %** | **98.9 %** | **95.8 %** | **66.1 %** |
| Raw op attempts, all files (464 applicable ops) | | | 460/464 = 99.1 % | 430/464 = 92.7 % | |
| Raw op attempts, the 4 distinct engineer files (207 ops) | | | 204/207 = 98.6 % | 184/207 = 88.9 % | **41/207 = 19.8 %** |

The last column is the number a user feels. On 3 of the 4 distinct engineer
files, the export route refuses every export with
`409 cannot write CompoundObject`. That is bug S1-01. The writer itself would
have written the file. The route stops it first.

| Check | Result |
|---|---|
| Files read without an error | 15/15 |
| Screens drawn by the server rasteriser | 54/54 modelled screens (0 render errors) |
| Modelled parts that draw something | 100 % |
| `.co` read, drawn, value edit survives, untouched write byte-identical | 4/4 |
| OTE Expert opens our output | **not verified**: OTE Expert is not installed on this machine |

## Per file

The `.co` files have no screen ops (see "What a `.co` measures"). For a `.co`,
"took edit" and "survived" mean the `setCoValues` edit and its round trip.

| File | Tracked | Panel | Driver | Read % | Drew % | Screens drawn | Took edit % | Survived (writer) % | Export route | OTE opens it |
|---|---|---|---|---|---|---|---|---|---|---|
| demo_objects/HMICopilot_FlowTile.co | yes | n/a | n/a | 100 | 100 | n/a | 100 (value edit) | 100 | n/a | not verified |
| demo_objects/HMICopilot_LevelTile.co | yes | n/a | n/a | 100 | 100 | n/a | 100 (value edit) | 100 | n/a | not verified |
| demo_objects/HMICopilot_PumpSpeed.co | yes | n/a | n/a | 100 | 100 | n/a | 100 (value edit) | 100 | n/a | not verified |
| demo_objects/HMICopilot_TankLevel.co | yes | n/a | n/a | 100 | 100 | n/a | 100 (value edit) | 100 | n/a | not verified |
| demo_project/HMICopilot_Bars.eote | yes | HMIST6500AWADI 1024x600 | none | 100 | 100 | 4/4 | 100 | 94.0 | accepted | not verified |
| demo_project/HMICopilot_FromBrowser.eote | yes | HMIST6500AWADI 1024x600 | none | 100 | 100 | 1/1 | 100 | 100 | accepted | not verified |
| demo_project/HMICopilot_Minimal.eote | yes | HMIST6500AWADI 1024x600 | none | 100 | 100 | 1/1 | 100 | 100 | accepted | not verified |
| demo_project/HMICopilot_PumpStation.eote | yes | HMIST6500AWADI 1024x600 | none | 100 | 100 | 1/1 | 100 | 100 | accepted | not verified |
| demo_project/HMICopilot_Symbols.eote | yes | HMIST6500AWADI 1024x600 | none | 100 | 100 | 1/1 | 100 | 100 | accepted | not verified |
| demo_project/HMICopilot_TS.eote | yes | HMIST6500AWADI 1024x600 | none | 100 | 100 | 1/1 | 100 | 100 | accepted | not verified |
| demo_project/HMICopilot_Drive_4.1.eote | no | HMIST6600 1280x800 | Schneider Electric / SoMachineNetwork | 100 | 100 | 1/1 | 98.2 | 89.3 | **409** (CompoundObject) | not verified |
| demo_project/HMICopilot_Panel1.eote | no | HMIST6600 1280x800 | Schneider Electric / SoMachineNetwork | 95.5 | 100 | 9/9 | 98.4 | 85.9 | **409** (CompoundObject) | not verified |
| demo_project/Motor_Drive_Control_4.1.eote | no | HMIST6600 1280x800 | Schneider Electric / SoMachineNetwork | 100 | 100 | 8/8 | 100 | 100 | accepted | not verified |
| samples/hmi-panel-1/auto-manual.eote | no | HMIST6600 1280x800 | Schneider Electric / SoMachineNetwork | 83.7 | 100 | 8/8 | 97.8 | 82.6 | **409** (CompoundObject) | not verified |
| auto&manua.eote (same bytes as the line above) | no | HMIST6600 1280x800 | Schneider Electric / SoMachineNetwork | 83.7 | 100 | 8/8 | 97.8 | 82.6 | **409** (CompoundObject) | not verified |

Read % is the share of objects under the screen roots that the reader models
(editable). The rest are carried byte-for-byte and are not lost. On
`auto-manual.eote` the 16.3 % carried is the 6 objects of its master screen and
1 HardwareConfiguration on an ordinary screen.

What else the engineer files hold, all carried unchanged unless edited:

- 11 Compound Object definitions each;
- 302 to 330 binding rows the reader does not model;
- 42 of 162 variables of data types the model does not cover (see the panels
  section);
- one SoMachineNetwork driver and one equipment each.

## Per part type

Each row gives the number of instances in all distinct files and in the engineer
files. "Read" is the share of instances that are modelled. "Drew" is the share
of modelled instances that draw. The edit columns count the applicable op
attempts.

`byKind` cells read survived/took/applicable, for move, resize, setText,
setColor, add and delete.

| Part type | Instances (all / real) | Read % | Drew % | Took edit % | Visible % | Survived (writer) % | Survived and exportable % | move | resize | setText | setColor | add | delete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TextBox | 351 / 241 | 99.4 | 100 | 100 | 83.3 | 100 | 70.0 | 10/10/10 | 10/10/10 | 10/10/10 | 10/10/10 | 10/10/10 | 10/10/10 |
| Rectangle | 295 / 209 | 100 | 100 | 100 | 91.3 | 100 | 76.1 | 9/9/9 | 9/9/9 | n/a | 9/9/9 | 10/10/10 | 9/9/9 |
| NumericDisplay | 71 / 56 | 100 | 100 | 100 | 100 | 92.0 | 62.0 | 8/8/8 | 8/8/8 | 8/8/8 | 8/8/8 | 10/10/10 | **4/8/8** |
| Lamp | 34 / 8 | 100 | 100 | 100 | 70.0 | 92.5 | 65.0 | 6/6/6 | 6/6/6 | 6/6/6 | 6/6/6 | 10/10/10 | **3/6/6** |
| CompoundObject (instance) | 23 / 23 | 100 | 100 | 80.0 | 60.0 | 60.0 | **0** | 3/3/3 | 3/3/3 | **0/0/3** | 3/3/3 | n/a | **0/3/3** |
| Path | 21 / 8 | 71.4 | 100 | 100 | 100 | 100 | 50.0 | 4/4/4 | 4/4/4 | n/a | 4/4/4 | n/a | 4/4/4 |
| AlarmSummary | 18 / 12 | 100 | 100 | 100 | 81.0 | 95.2 | 64.3 | 8/8/8 | 8/8/8 | n/a | 8/8/8 | 10/10/10 | **6/8/8** |
| ContentDisplay | 10 / 10 | 80.0 | 100 | 100 | 100 | 33.3 | **0** | 2/2/2 | **0/2/2** | n/a | n/a | n/a | **0/2/2** |
| Switch | 8 / 6 | 100 | 100 | 100 | 80.0 | 95.0 | 55.0 | 2/2/2 | 2/2/2 | 2/2/2 | 2/2/2 | 10/10/10 | **1/2/2** |
| ToggleSwitch | 6 / 6 | 100 | 100 | 100 | 73.3 | 90.0 | 40.0 | 4/4/4 | 4/4/4 | 4/4/4 | 4/4/4 | 10/10/10 | **1/4/4** |
| StringDisplay | 4 / 4 | 100 | 100 | 100 | 100 | 88.0 | 28.0 | 3/3/3 | 3/3/3 | 3/3/3 | 3/3/3 | 10/10/10 | **0/3/3** |
| TrendGraph | 4 / 4 | 100 | 100 | 100 | 100 | 100 | 78.6 | 1/1/1 | 1/1/1 | n/a | 1/1/1 | 10/10/10 | 1/1/1 |
| Pipe | 3 / 0 | 100 | 100 | 100 | 92.9 | 100 | 78.6 | 1/1/1 | 1/1/1 | n/a | 1/1/1 | 10/10/10 | 1/1/1 |
| DateTimeDisplay | 2 / 2 | **0** | n/a | (add only) 100 | 100 | 100 | 70.0 | n/a | n/a | n/a | n/a | 10/10/10 | n/a |
| HardwareConfiguration | 2 / 2 | **0** | placeholder | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| N-StateLamp, BarScale, BlockTrend | 0 / 0 (add only) | n/a | n/a | 100 | 100 | 100 | 70.0 | n/a | n/a | n/a | n/a | 10/10/10 | n/a |
| Containers (not parts): Grid, Canvas, ViewBox | 4 per master-screen file | resolved into boxes | n/a | n/a | n/a | n/a | n/a | | | | | | |

How to read the weak cells:

- **Delete on any bound type** (NumericDisplay, Lamp, AlarmSummary, Switch,
  ToggleSwitch, StringDisplay, CompoundObject).
  - Deleting a bound part removes its wire, so the writer rebuilds `Bindings.dat`
    from the model.
  - The rebuild rewrites bindings the engineer never touched: S1-02. On the
    master-screen files, every rebuild rewrote 10 Compound Object target rows and
    10 to 18 variable source rows.
  - Deleting a part whose binding the reader could not model leaves that binding
    row aimed at a part that no longer exists: S1-04. The script measured 1 such
    row on each master-screen file, after an AlarmSummary was deleted.
  - In `HMICopilot_Bars.eote` the rebuild also moved two Switch bindings from
    `CurrentValue` to `ClickTrigger.Destination`, Mode 1
    (`bindings.ts:147,163,168`). That is a deliberate correction of the app's
    own older output, not a loss.
- **CompoundObject.**
  - setText is refused, `<name> is a CompoundObject and carries no text`
    (`core/ops/apply.ts:714-722`), although each instance exposes a `Text`
    value. CO_FORMAT.md "Not yet" says so.
  - Delete fails as described above.
  - Nothing that holds an instance can be exported: S1-01.
- **ContentDisplay resize and delete.**
  - The file is right. The editor is not. A content screen laid out by a Grid is
    laid out at the size of the display that shows it (`reader.ts:192-197`,
    `434-435`).
  - After a resize or a delete, the reopened file therefore places 10 content
    parts somewhere other than where the canvas showed them before the export.
    That is S1-13 (P3). It counts as a failure here because the editor's model
    and the file disagree.
- **Visible % below 100**: the app applied the op and reported it done, but the
  part's drawing did not change. These are the measured counts of applied,
  not-visible ops:

  | Op | Part type | Ops with no visible change | Why |
  |---|---|---|---|
  | setColor | TextBox | 11 | The fill is written to `Fill.Color.Value`, and the TextBox's drawing did not change. |
  | setColor | AlarmSummary | 9 | The same. |
  | setColor | Lamp | 6 | Lamp, Switch and ToggleSwitch draw their colour from their faces (`Off`/`On`, `Release`/`Press`), and the op writes a top-level `Fill` (`core/ops/apply.ts:766-767`). |
  | setColor | ToggleSwitch | 5 | The same face problem. |
  | setColor | Switch | 2 | The same face problem. |
  | setColor | CompoundObject | 4 | The instance draws from its definition's `Look`, which the op does not touch. |
  | setColor | Pipe | 1 | not investigated |
  | setText | Lamp | 6 | `op.text` sets the On face (apply.ts:730-731), and the canvas draws the Off face. |
  | setText | ToggleSwitch | 5 | The same. |
  | setText | Switch | 2 | The same, with the Press face. |
  | move | Rectangle | 4 | The SVG string came out identical, which needs checking. |

  Each of these reports success to the engineer or the model. This is S1-11
  (P2, wrong output).

## The panels and part types the real files use

Shaurya reports panels that "throw errors when read". **On the 15 files here,
nothing throws**:

- every file reads;
- every modelled screen draws;
- no op throws in core/ops;
- no export throws in the writer.

The search followed the brief: `backend/panels.ts`, `ote/reader.ts`, `struct.ts`,
`parts.ts` and `layout.ts`. It found the things below, which a user sees as an
error, or as a screen that is wrong or missing. The likeliest match for the
report is the **MasterScreen**: the frame every screen of the Panel-1 project
is drawn inside. The reader drops it from the editor with one warning line. The
editor, `render_screen` and the critic then show every screen without its
header.

### Panel models (Target.dat)

| Panel model | Resolution | Files | In `PANELS` (backend/panels.ts:207-213) | Status |
|---|---|---|---|---|
| HMIST6500AWADI | 1024x600 | 6 tracked (ours) | yes | supported |
| HMIST6600 | 1280x800 | all 4 engineer files | **no** | **partly supported**. The reader takes the size from `Target.dat`, and the screens draw at 1280x800. The panel list does not hold this model, so the target picker (`components/shell/targets.ts:24`) does not offer it, and `panelFromValue` (panels.ts:232-242) marks it provisional. Fix: add the row `{ model: "HMIST6600", width: 1280, height: 800, formats: ["eote"], viewing: "touch" }`, after checking it against `Models-*.xml` in an OTE install. |

### Driver

| Driver (DriverConfig.db) | Files | Status |
|---|---|---|
| Schneider Electric / SoMachineNetwork (1 equipment) | 4 engineer files | Carried byte-identical in every export measured (no `entry changed` on DriverConfig.db). It is not modelled, by design, and the agent workspace hides it (`lib/agent/workspace.ts:23`). |

### Screens

| Screen kind (Type / root) | Files | Status |
|---|---|---|
| Screen / Canvas, ViewBox | all | supported |
| Content / Grid (shown in a ContentDisplay) | 2 distinct (5 each) | supported. Laid out by `containers.ts`; edits go back through `mergeTree`. |
| **MasterScreen / Grid** | `HMICopilot_Panel1.eote`, `auto-manual.eote` (=`auto&manua.eote`) | **unsupported: carried whole**. `Screen.Type` is `z.enum(["Screen","Content"])` (`schema.ts:889-891`), so `Screen.safeParse` fails with `Invalid enum value. Expected 'Screen' \| 'Content', received 'MasterScreen'` (`reader.ts:219` / `280`). The reader then carries the screen (`reader.ts:436-441`) with the warning "1 screen could not be modelled (root: 1 Grid)". That warning names the root, not the cause. What is lost in the app: the master's 6 objects (3 Path, 1 TextBox, 1 DateTimeDisplay, 1 ContentDisplay) are not drawn, not editable and not shown behind the screens they frame. The file keeps them. Fix: allow `MasterScreen` in `Screen.Type`, keep `MasterScreenType`, `EnableHeader`, `HeaderHeight` and `HeaderFill` (passthrough), model it as a screen the editor shows, and draw it behind every screen whose hierarchy branch hangs under it (packager.ts `rehang` already knows that branch). See S1-10. |

### Part types

| Part type | Real instances | Status | What is lost, or the error | What the fix needs |
|---|---|---|---|---|
| TextBox, Rectangle | 241, 209 | supported | nothing measured | none |
| NumericDisplay, StringDisplay, TrendGraph, AlarmSummary, Switch, ToggleSwitch, Lamp | 56, 4, 4, 12, 6, 6, 8 | supported for read, draw, move, resize, text and add; **partly** for delete | A delete rebuilds Bindings.dat and rewrites untouched rows (S1-02), or leaves dangling rows (S1-04). On Lamp, Switch and ToggleSwitch, setColor has no visible effect. | Keep the raw rows of unchanged wires on rebuild. Drop carried rows whose target is gone. Make setColor write the face fills on stateful parts. |
| CompoundObject instance | 23 | **partly supported** | Reads, draws from its definition, moves, resizes and takes a fill. Text edit is refused. A delete rewrites its siblings' binding rows. **Any project holding one cannot be exported** (S1-01: `409 cannot write CompoundObject`). | Add `"CompoundObject"` to the writable parts (`schema.ts:910` PART_TYPES or `backend/ote.ts:24`). Give setText a path into `Text.<state>` on the instance. Emit `SubType: "CompoundObject.<Definition>"` in `buildGraph`. |
| ContentDisplay | 10 | partly supported | 8 of 10 read. The 2 unread ones are on the master screen. Resize and delete re-lay the content screen on reopen, which the editor does not show (S1-13). | Re-lay the shown content in the store when its display changes size. |
| Path | 8 | partly supported | 5 of 8 read. The 3 unread ones are on the master screen. | Model MasterScreen. |
| DateTimeDisplay | 2 | unsupported in these files (supported elsewhere) | Both instances sit on the master screen, so neither is read or drawn. Added ones work. | Model MasterScreen. |
| HardwareConfiguration | 2 | **unsupported: carried** | Not in the Part union. `Part.safeParse` fails with `Invalid discriminator value. Expected 'Rectangle' \| ... \| 'CompoundObject'`. It is carried byte-identical and drawn as a hatched placeholder if it has a box. The canvas cannot show or edit it. | A read-only part that keeps the raw object and draws a labelled placeholder (Stage 2's "safe read"). It is a hardware widget, so editing it is not needed. |
| Grid, Canvas, ViewBox (containers) | 4 | supported as layout | Resolved into boxes (`containers.ts`), not editable as containers. A move re-pins the part in its cell (`pinInGrid`). | none for fidelity (design B/A territory) |

### Variables (Variables.db), which the screens bind to

| Data type | Rows per engineer file | Status |
|---|---|---|
| BOOL, WORD, UINT, DWORD, UDINT, DINT, STRING | 120 | modelled |
| TIME | 22 | **not modelled** (`schema.ts:946-957` DATA_TYPES; `reader.ts:531-534` skips the row). It is carried in Variables.db. A binding to one is carried as an unmodelled row, and the tag list and the binder cannot offer it. |
| USINT | 1 | not modelled, as for TIME |
| Machine Expert structured and function-block types (10 kinds) | 19 | not modelled, as for TIME; structure members are carried |

**InitialValue.** 22 of the 120 modelled variables in each engineer file carry a
non-default `InitialValue`. Any variable edit resets all 22 to the type default
(S1-03, `databases.ts:140-143`).

## What a `.co` measures

`core/ops` edits a project's screens. It has no path into a `.co` definition:
no op of the six kinds reaches one. So for the 4 `.co` files the six screen ops
are "n/a". The script runs the app's own `.co` edit, `setCoValues` (the path
`hmi co` and the agent take), on one numeric and one text property. All 4
survived `writeCo`, then `readCo`, with only `Screen.dat` changed and 0
`checkCo` problems after. An untouched write gave 20/20 entries byte-identical
on each. Each draws through `co-look` as an instance, and the script saved the
renders. All 4 `.co` files are ours (demo_objects). Schneider's installed
`COs.pkg` and the published Pro-face set are not on this machine, so
`tests/co.test.ts` skips 2 tests here.

## What this cannot prove

- **That OTE opens our output.** OTE Expert is not installed on this machine.
  Every "survived" above means "our own reader reads back what the store
  holds". If the reader and the writer share a misunderstanding of the format,
  this measurement cannot see it.
  - Example: the rebuilt CO target `SubType: "CompoundObject"` reads back fine
    here, and only OTE can say whether it still resolves.
  - The OTE bench (`web/scripts/ote-bench.ps1`, `ote-bench-all.ps1`, the
    licensed 4.4.20.31 and the lab's 4.1) is the only proof. It has not been
    run on any of these outputs.
- **That runtime behaviour is kept.** Scripts, Compound Object state logic and
  driver traffic are carried, not run.
- **The browser.** The draw step uses the server rasteriser (`StaticScreen`).
  The editor uses `ScreenRenderer`, which shares the parts but adds its own
  hooks. Any error that only shows in the browser canvas is not covered.
- **Breadth.** There are 4 distinct engineer projects from one site and one
  driver, plus our own outputs. There is no 3.x `.vxdz`, no `.vdz` and no OTE
  template pack here.
  - `tests/struct.test.ts` and `tests/contents.test.ts` hard-code
    `C:/Users/shaur/Downloads/EOTE_Template_v7`. Those 95 templates are the
    real breadth test, and they run only on Shaurya's machine.
- **Which edits real users make.** The weights are the frequency of part types,
  not of edits.
- **Every instance.** The script edits one instance of each type per file. A
  per-instance fault (one odd TextBox) can hide in that sample.

## Why tests skip (baseline: 24 skipped)

**No skip in the suite depends on the gitignored engineer files being absent.**
The rig tests find the files on this machine and run:

- `co-look.test.ts`, `exemplars.test.ts`, `fidelity.test.ts`,
  `real-panel.test.ts`;
- `agent-workspace.test.ts` "on the rig".

The 24 baseline skips are these:

| File | Skipped | Condition | Verdict |
|---|---|---|---|
| tests/demo-path.test.ts | 15 | `HEAD http://localhost:3000/` not ok at load (`demo-path.test.ts:59-61`) | Correct condition. At baseline time the server did not answer `ok`. Re-run here with the shared server up: **25 passed, 0 skipped**. |
| tests/struct.test.ts | 1 | `C:/Users/shaur/Downloads/EOTE_Template_v7` (`struct.test.ts:187`) | **Wrong condition**: a hard-coded path in Shaurya's home folder, never true on another machine. It should be `join(homedir(), "Downloads", ...)` or an env var. |
| tests/contents.test.ts | 2 | same path (`contents.test.ts:140`) | **Wrong condition**, as above. |
| tests/co.test.ts | 2 | the OTE install `COs.pkg` and `~/Downloads/Compound Object` (`co.test.ts:226-227`) | Correct: neither is on this machine. |
| tests/pictures.test.ts | 1 | the OTE clipart folder | Correct: OTE is not installed. |
| tests/imports.test.ts | 2 | `MONGODB_URI` set | Correct: the audit runs with `MONGODB_URI=` empty on purpose. |
| tests/agent-shell.test.ts | 1 | `AGENT_LIVE=1` and a Vercel OIDC token | Correct. |

## Before and after

| Run | Weighted read | Drew | Took edit | Survived (writer) | Survived and exportable |
|---|---|---|---|---|---|
| Before fixes (5fd701d) | 98.4 % | 99.3 % | 98.9 % | 95.8 % | 66.1 % |
| After fixes (Stage 2) | to fill | | | | |
