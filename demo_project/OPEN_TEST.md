# Open test — generated EcoStruxure projects

Two complete `.eote` project files, written from scratch by `tools/make_project.py`.
Neither was ever saved by EcoStruxure Operator Terminal Expert.

**These need no compound-object licence.** They contain no compound objects at all —
primitive parts are placed directly on a screen, which is how screens are normally
authored. That was the whole point of moving from `.co` to `.eote`.

## How to open

There is nothing to import. In EcoStruxure Operator Terminal Expert:

**File ▸ Open Project** → select the `.eote` file.

Or just double-click it — `.eote` is registered to the application.

## What you should see

| File | Contents |
|---|---|
| `HMICopilot_PumpStation.eote` | The real one — 19 parts, 7 tags, 5 alarms, 11 bindings |
| `HMICopilot_Minimal.eote` | Same layout with rectangles instead of Lamps / NumericDisplay / AlarmSummary, and no bindings |

Open `HMICopilot_PumpStation.eote` first. `Screen1` should show:

- a green banner reading **Pump Station 1**
- a **PUMPS** panel with two status lamps (grey "STOPPED" → green "RUNNING") and two
  fault lamps (grey "OK" → red "FAULT")
- a **PROCESS** panel with two numeric displays for flow and level, with units
- an **ACTIVE ALARMS** summary across the bottom

Then check that the work an engineer would otherwise do by hand is already done:

- **Variables** — seven tags, correctly typed, with comments:
  `PMP_101_RUN`, `PMP_101_FLT`, `PMP_102_RUN`, `PMP_102_FLT` (BOOL),
  `FT_101_PV`, `LT_101_PV` (REAL), `LT_101_HI` (BOOL)
- **Bindings** — select `Lamp_PUMP1_RUN` and its `CurrentValue` should already be
  bound to `PMP_101_RUN`. Same for the other lamps and both numeric displays.

That last point is the demo. The screens are drawn *and* the tags are wired, from
nothing but a tag list.

## If it fails

Note which file and the exact message — the two files fail independently:

- **Both fail to open** → the archive or a root `.dat` is being rejected. Check whether
  the error names a specific file.
- **Only `HMICopilot_PumpStation` fails** → a part type or a binding is malformed.
  `HMICopilot_Minimal` uses only TextBox / Rectangle, so if it opens, the project
  skeleton is correct and only the parts need adjusting.
- **Opens but a part looks wrong or is missing** → best case. The project is valid and
  only property values need tuning.
- **Opens but bindings are absent** → the screen generation is right and only
  `Bindings.dat` needs work; the tags will still be in the Variables editor.

## Regenerating

```
python tools/make_project.py demo_project
```

Fresh GUIDs every run. Tags live in the `TAGS` list at the top of the script — the
real product derives them from an uploaded PLC export instead.

## How it was built

`Blank.eote` from `BuildtimeData\ProjectTemplates` is the skeleton — it supplies the
Alarm, Recipe, Security and Language databases untouched. The generator then writes:

- the tags into `Variables.db` (plain SQLite, no encryption)
- `Screens\<guid>\Screen.dat` — the object tree, absolute-positioned in a ViewBox
- `Screens\<guid>\Metadata.dat` and `Screens\Hierarchy.dat`
- `Bindings.dat` — the `Sources` → `Bindings` → `Targets` graph

Part shapes and binding property names were taken from the shipped sample projects
rather than guessed; `reference/part_examples.json` holds one real example of each of
the 50 part types those projects use.
