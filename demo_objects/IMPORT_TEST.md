# Import test — generated compound objects

Three `.co` files, written from scratch by `tools/make_demo_co.py`. None of them
were exported from EcoStruxure Operator Terminal Expert — they were packed by our
own code and are what an engineer would receive from HMI Copilot.

## How to import

1. Open EcoStruxure Operator Terminal Expert (any project, a blank one is fine)
2. In **Project Explorer**, select **Compound Object Library** (or **Project Compound Objects**)
3. On the toolbar, click the import **drop-down** ▸ **Import from File**
4. Select one of the `.co` files below
5. Repeat for the other two

Then drag each imported object onto a screen to see it render.

## What you should see

| File | Expected appearance | What it proves |
|---|---|---|
| `HMICopilot_TankLevel.co` | Vertical bar, **blue** (`#1B7FD4`) on grey, filled to 75% | Identity rewrite and recolouring survive import |
| `HMICopilot_PumpSpeed.co` | Arc gauge, **amber** (`#E3A008`), two layered arches | The packager generalises across template types, and multi-child binding wiring holds |
| `HMICopilot_FlowTile.co` | Horizontal green bar **on a light backing panel with a grey border** | We authored a new object into the tree — the panel does not exist in any shipped object |
| `HMICopilot_LevelTile.co` | A tile: label "Level" on top, a blue vertical bar half full, the reading below | **Built from nothing** by `lib/ote/co-build.ts` from `specs/HMICopilot_LevelTile.json` — no shipped object was copied. Its properties (Current Value, Min, Max, Label, Bar, Bar Background) should appear in the Properties pane |

The third file is the important one. The first two prove we can rewrite an object;
`HMICopilot_FlowTile` proves we can **add geometry that Schneider never shipped**
and have OTE accept it. That is the whole product in miniature.

## If an import fails

Note which file and the exact error message. The three files fail independently,
and each one failing tells us something different:

- **All three fail** → the archive itself is being rejected. Most likely the entry
  name separators or the compression method. Fast to fix.
- **Only `HMICopilot_FlowTile` fails** → rewriting works, authoring new children
  needs a property we have not set. Also fast to fix — and the other two still
  prove the pipeline.
- **Import succeeds but the object renders wrong** → the file is valid and only the
  geometry or colour mapping needs adjusting. This is the best kind of failure.

**Result, 16 October 2026:** `HMICopilot_FlowTile` and `HMICopilot_PumpSpeed` imported into
the licensed OTE 4.4.20.31. OTE changed only the identity (a new Id and a `1` suffix where
the name was taken) and the version stamp; docs/CO_FORMAT.md has the comparison.

## Regenerating

```
python tools/make_demo_co.py demo_objects
cd web && npm run hmi -- co build ../demo_objects/specs/HMICopilot_LevelTile.json -o ../demo_objects/HMICopilot_LevelTile.co
```

The script re-reads the shipped library at
`Buildtime\TemplateCOs\COs.pkg` each run and assigns fresh GUIDs every time, so
repeated imports never collide with an earlier one.
