# HMI Copilot as an agentic screen generator, tested on licensed OTE

*16 October 2026. Written after the team received a licensed EcoStruxure
Operator Terminal Expert 4.4 (build 4.4.20.31, pre-production licence server,
see memory note). Every fact below is tagged **install** (read from the
product's files on this machine), **help** (the product's offline feature
guide), **bench** (seen by driving the licensed editor), or **web**.*

---

## 1 · What the licensed product changes

Until now "it opens in OTE" was checked by hand, a few times, on files we
picked. With a licence on this machine the product itself can judge every
file we write, on every change.

### 1.1 · The bench (`web/scripts/ote-bench.ps1`)

OTE has no command line and no API (**install**: no CLI switches in the
executable or Buildtime assemblies; nothing in the help). It is a WPF
application, and WPF publishes a full **UI Automation** tree, so the editor
can be driven the way a screen reader drives it:

| Step | How | Found by |
|---|---|---|
| Open | start the editor with the file path | bench |
| Know it opened | Project Explorer text `Screens (n)`, `All Variables (n)`, `All Alarms (n)` | bench |
| Answer prompts | `PART_YesButton` / `PART_OKButton` in any window the editor raises | bench |
| Simulate | the toolbar item whose HelpText is "Simulate and verify the runtime operations…", its `PrimaryFunctionButton` (Invoke) | bench |
| Simulated | `PCPlatform.exe` starts | install, bench |
| Errors | the Errors pane (AvalonDock anchorable titled "Errors") | bench |
| Pictures | `PrintWindow` (renders the window, needs no screen) | bench |

This works from a non-interactive shell, where SendKeys and CopyFromScreen
fail ("The handle is invalid"), which is exactly how a coding agent runs.
Only processes the bench started are ever stopped, by PID.

### 1.2 · First finding: every file we write raises a prompt

Opening `HMICopilot_Minimal.eote` shows **"The project file was edited in
version … Convert the project file to version 4.4?"** before anything else
(**bench**). Our packager stamps `VersionModified: "4.4.0.0"` (copied from the
shipped `Blank.eote`); the installed build is `4.4.20.31` and a file saved by
Schneider's own 4.4 (Krishnadas's `Simple.eote`) says `4.4.20.29`. An engineer
opening our export meets a conversion question first. To be fixed by stamping
the build the file is meant for, once the bench confirms which values avoid
the prompt.

---

## 2 · The product's own libraries, all on disk

| Library | Where (`Buildtime\…`) | Count | Used today |
|---|---|---|---|
| Vector symbols (`.path`) | `PropertyDefinitions\ScreenDesign\GraphicObjects\03-Icons` | 475 in 13 groups (pumps, tanks, valves, fans, compressors, pipes, weather…) | yes, as Path parts |
| **Cliparts (PNG)** | `…\GraphicObjects\04-Cliparts` | **200** in 10 groups: Blowers, Boilers, FlowMeters, Food, HVAC, MaterialHandling, Motors, Pumps, Tanks, Valves | **no** |
| **Compound objects** | `TemplateCOs\COs.pkg` (same as ProgramData copy) | **14**: Gauge_10/20/100/200, BarGraph_Horiz/Vert_10…50, each with `CurrentValue, Min, Max, Colors` | **no** |
| Switch images | `HMIImages` | 100 PNG (Blue/Black/Red O/OM/P/PM/R, press/release, on/off) | no |
| Navigation templates | `BuildtimeData\NavigationTemplates` | 4: Blank, Icon, Left, Slide | no |
| Project templates | `BuildtimeData\ProjectTemplates` | Blank, Demo 1, Demo 2, Sample Alarm/Logging/Recipe | as test corpus |
| Part schemas | `PropertyDefinitions\ScreenDesign\GraphicObjects\01-Parts, 02-Shapes, 00-LayoutObjects` | 24 parts, 16 shapes, 13 layouts | partly |
| Enums | `PropertyDefinitions\SystemEnums.enumdef` | every enum the files use | yes (containers) |
| Limits | `BuildtimeData\Configs\ApplicationMaxLimit.json` | 8,999 screens, 2,048 objects/screen, 65,535 variables, 32 alarm groups, 256 MB project | partly |
| Drivers | `BuildtimeData\IOManager\Drivers` | Modbus TCP, CODESYS, Beckhoff ADS, CANopen… | no |

Web (**web**): Schneider publishes a further *EOTE Compound Objects* data
library (`Compound Object.zip`, 236 KB, 13 Jun 2025) on se.com; the direct
download needs a browser session, so it has to be fetched by hand.

### 2.1 · How a picture is stored (solved)

`Image` and `ClipArt` parts carry `ImagePath.Value` = the **SHA-1 of the PNG
bytes**, and the bytes live at `Resources\<sha1>.png`. `Resources.dat` maps
each resource key to one entry per use: `{Type: 0, Value: <sha1>,
DisplayValue: <original path>}` for images, `{Type: 2, Value: "<font id>"}` for
fonts (**install**, Demo 1: 82 PNG resources, all keyed). So pictures can now be
read for the canvas and written into an export. The older layout keeps them at
`Resource\<id>.png` by `ResourceID`.

### 2.2 · Native structure the generator should emit (help)

- **Folders and master screens.** Creating a folder creates its master screen.
  Header and footer live on the master and appear on every screen in the
  folder. At most **two folder levels**.
- **Navigation** per folder: Left, Icon, Slide or Blank. The first three create
  the navigation switch on the master automatically; Blank leaves it to a
  Screen Change switch, which can sit in the header so every screen has it.
- **Root types and the header.** View Box and Grid screens shrink to the area
  the header and footer leave; Canvas does not (its bottom is cut off).
- **Popups** are content screens; a faceplate popup is a content screen shown
  by a Content Change operation or a ContentDisplay.
- **Compound objects** take parameters through bindable custom properties.

---

## 3 · The agentic generator

Today the pipeline is a fixed sequence (infer → plan → architect → compile)
with one model call for the plan and a separate chat agent for edits. "Fully
agentic" means one loop that **acts, checks its own work against the product,
and repairs**, with the engineer approving what lands.

```
goal ("pump station, 2 duty pumps…") + tags
  └─ agent loop (Claude / Gemini / none: deterministic tools still run)
       ├─ look:     inspect_project, find_tags, find_library (symbols, cliparts, COs),
       │            read_conventions (knowledge base), read_limits
       ├─ decide:   plan_screens (ScreenProgram per screen, master/folder/nav)
       ├─ act:      compile_program, place_library_object, bind, add_alarm
       ├─ check:    preflight, semantic validation, ISA-101 lint, render + vision critic,
       │            ote_bench (licensed product: opens? simulates? errors pane?)
       └─ repair:   one finding → one targeted op, until clean or budget spent
  └─ proposal (diff + ghosts) → engineer accepts per change → export
```

Every check above already exists except `ote_bench` as a tool, library
placement for cliparts and compound objects, and master-screen emission.

## 4 · `hmi` CLI

The same operations without the browser, for engineers and for other agents:

```
hmi inspect  <file>                 screens, objects, tags, alarms, what is carried
hmi validate <file>                 preflight + naming + semantic, every problem at once
hmi convert  <old.vxdz> -o new.eote 3.1-3.3 project → 4.4
hmi generate --tags t.csv "…" -o out.eote
hmi agent    --tags t.csv "…"       the loop in §3, printing each step
hmi bench    <file|dir>             licensed OTE: open, simulate, errors (Windows)
hmi corpus   <dir>                  open / round-trip / edit / preflight harnesses
hmi library  [symbols|cliparts|cos] what the installed product ships
```

## 5 · Phases

1. **Bench + corpus on the licensed product** – run every export we produce
   and the template corpus; fix what the product rejects (version stamp first).
2. **Libraries** – index cliparts and compound objects from the install; place
   ClipArt (with its resource) and compound-object instances; draw them.
3. **Native structure** – folders, master screen with header/footer,
   navigation template; faceplate popups as content screens.
4. **Agent loop** – tools of §3 behind one loop with a budget; streamed steps;
   proposals, never silent commits.
5. **CLI** – `web/bin/hmi` over the same library code.
