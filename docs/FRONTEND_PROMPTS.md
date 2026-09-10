# HMI Copilot — Frontend Build Prompts

Paste-ready prompts for Lovable / v0 / Bolt / Claude Code.

**Use them in order.** Prompt 0 establishes the design system — run it first and let it finish, or every later screen will drift in style. Prompts 1–9 each build one screen or panel on top of it.

Mock data is in the [Appendix](#appendix-mock-data) — paste it alongside any prompt that needs it, so the UI is built against the real shapes our backend emits rather than invented ones.

---

## Prompt 0 — Design system and foundation

```
Build the foundation for "HMI Copilot", an AI engineering assistant that generates
industrial HMI screens for Schneider Electric's EcoStruxure Operator Terminal Expert.

The user is an industrial automation engineer. The product sits somewhere between
Figma and an IDE: dense, precise, technical. Not a consumer app, not a chatbot.
Think Linear or Cursor, not Notion.

Stack: Next.js (App Router) + TypeScript + Tailwind + Zustand. lucide-react for
icons. No component library — build the primitives.

All the screens in this set are client components ('use client') driven by local
state; the API routes come later, so keep data access behind a thin lib/ module
that currently returns mock data.

DESIGN SYSTEM

Theme: dark by default, with a working light mode toggle. Define everything as CSS
custom properties on :root and override in a [data-theme] block, so nothing is
hardcoded.

Dark palette:
  --bg-base       #0D1117   app background
  --bg-panel      #151B23   panels
  --bg-elevated   #1C2430   cards, inputs, popovers
  --border        #2A3441
  --border-strong #3A4756
  --text-primary  #E6EDF3
  --text-secondary #8B99A8
  --text-muted    #5A6673

Accent (Schneider green — use sparingly, for primary actions and active state only):
  --accent        #3DCD58
  --accent-hover  #34B34C
  --accent-dim    rgba(61,205,88,0.12)

Semantic status — these carry meaning throughout the app, never decorate with them:
  --ok      #3DCD58   valid, bound, passing
  --warn    #E3A008   unbound tag, missing recommended element
  --error   #F04438   invalid, type mismatch, naming violation
  --info    #3B9EFF   AI-generated, changed in last step

Light mode: same hues, inverted surfaces, keep the accent and semantic colors.

Typography:
  UI text — Inter, 13px base. This is a dense tool; do not use 16px body text.
  Code, tag names, JSON, addresses — JetBrains Mono, 12px.
  Tag names must ALWAYS be monospace, everywhere in the app.

Spacing: 4px grid. Panel padding 12px. Compact.
Radius: 6px cards and inputs, 4px small controls.
Borders over shadows. This is a technical tool; keep it flat.

Motion: 150ms ease-out for state, 300ms for layout. Respect prefers-reduced-motion.

BUILD NOW
- Global CSS with the tokens above, plus the theme toggle
- Primitives: Button (primary/secondary/ghost/danger), IconButton, Input, Select,
  Checkbox, Badge (ok/warn/error/info/neutral), Tooltip, Tabs, Panel, Splitter,
  ScrollArea, Spinner, EmptyState
- An AppShell: 40px top bar (product mark left, project name center, theme toggle
  and Export button right) and a content slot below
- A Storybook-style /components route rendering every primitive in both themes

Make it feel sharp and engineered. No gradients, no rounded-everything, no emoji.
```

---

## Prompt 1 — Workspace shell

```
Build the main workspace screen at route /workspace. This is where the engineer
spends all their time. It is a four-region layout:

┌──────────────┬─────────────────────────────────────────┬──────────────────┐
│  INTENT      │           LIVE HMI CANVAS               │   INSPECTOR      │
│  320px       │           flexible                      │   360px          │
│  resizable   │                                         │   resizable      │
│              │                                         │                  │
├──────────────┴─────────────────────────────────────────┴──────────────────┤
│  BUILD TIMELINE — 140px, collapsible to a 32px strip                      │
└───────────────────────────────────────────────────────────────────────────┘

- Left and right panels resize by dragging their inner edge; min 260px, max 520px.
  Persist widths to localStorage.
- Each side panel collapses to a 40px icon rail via a chevron in its header.
- The timeline collapses to a single-line strip showing only the current step.
- Below 1280px the inspector auto-collapses. Below 900px show the canvas only,
  with the other panels as bottom-sheet tabs.

For now fill each region with a labelled placeholder that has the right header
and chrome — the header row, its title, and its action icons. Later prompts fill
in the contents.

Top bar: product mark "HMI Copilot" on the left, editable project name in the
center with a subtle "saved" indicator, and on the right a target-panel selector
(e.g. "HMIGTO6310 · 1024×768"), theme toggle, and a primary "Export" button.

State: one Zustand store, `useProjectStore`, holding
{ project, screens, tags, bindings, validations, timeline, selection, ui }.
Define the TypeScript types now — later prompts depend on them. Selection is
{ objectId: string | null } and is shared by canvas, tree, and binding map.
```

---

## Prompt 2 — Live HMI Canvas (the core screen)

> This is the most important prompt in the set. The canvas renders the *exact same JSON* that gets packaged into the `.co` file for EcoStruxure, so the preview can never lie about the output.

```
Build the LiveCanvas component that renders an EcoStruxure HMI screen definition
as inline SVG. Paste the mock `screenJson` from the appendix as the initial state.

THE DATA MODEL — render this faithfully, it is a real EcoStruxure format:

A screen is a tree of nodes. Every node has Type, UniqueId, Name and optional
Children. The types you must handle:

  "Grid"      — Rows[] and Columns[] arrays; their LENGTH is what matters
                (10 empty objects = 10 equal rows). Render as a CSS-grid-like
                layout inside an SVG <g>.
  "Path"      — vector shape, see decoding below
  "Lamp"      — indicator; boolean state drives fill color
  "NumericDisplay" — value + unit, right-aligned monospace
  "StringDisplay"  — text
  "Switch" / "ToggleSwitch" — momentary or latching control
  "TrendGraph"     — line chart over time
  "BarGraph"       — filled bar
  "AlarmSummary"   — table of active alarms
  "Text"           — static label

Child placement inside a Grid comes from node.Location:
  { Row, Column, RowSpan, ColumnSpan }  — all default to 0/0/1/1.

DECODING RULES — implement these exactly:

1. Colors are plain integers, 0xRRGGBB.
     toHex(v) => '#' + v.toString(16).padStart(6, '0')
     45136 -> #00B050,  34342 -> #008626,  14277081 -> #D9D9D9
   A color object may carry Transparency (0-100, where 75 means 75% opaque —
   map to fill-opacity 0.75).

2. Path nodes carry Path.Commands and Path.Data.
   Commands is a letter sequence, e.g. "MLLLLLzMLLLLLz".
   Data is a flat comma-separated coordinate list.
   Walk the commands, consuming coordinates:
     M -> moveto, 2 coords     L -> lineto, 2 coords     z -> closepath, 0 coords
   Emit a standard SVG path `d` string.
   Compute the bounding box of all coordinates and use it as the viewBox, with
   preserveAspectRatio="xMidYMid meet", so the shape scales to its grid cell.

3. Animation drives appearance:
   Animation.FillLevel { Enable, VerticalFill: 0-100, BackColor } — render the
   shape twice: the background color full-size, then the foreground clipped by a
   <clipPath> rectangle covering the bottom VerticalFill% of the bounding box.
   Animate the clip height with a 300ms CSS transition when the value changes.

RENDERING REQUIREMENTS

- ONE SVG DOM ELEMENT PER OBJECT, each with data-object-id={UniqueId}. This is
  non-negotiable: selection, hover, explain and diff highlighting all key off it.
  Do not render to <canvas>.
- Hover: 1px --info outline plus a tooltip with the object name and type.
- Click: select it — 2px --accent outline with corner handles, and push the id
  into store.selection so the inspector and binding map follow.
- Objects bound to a tag get a small monospace tag chip below them when the
  "Show bindings" toggle is on.

STREAMING RENDER — this is the signature behavior of the product:
Objects must appear one at a time as the AI generates them, never all at once
after a spinner. Give the canvas an `appearing` set of ids; a newly added object
fades and scales in from 0.96 over 300ms with a brief --info glow that decays.
Add a demo control that replays the current screen object-by-object at ~250ms
intervals so this can be shown on demand.

CANVAS CHROME
- Checkerboard or subtle dot-grid backdrop, with the HMI screen drawn as a
  bordered rectangle at the target resolution (1024×768), centered.
- Zoom controls bottom-right: fit / 100% / +/-, plus ctrl+scroll to zoom and
  space-drag to pan. Show the zoom percentage.
- Bottom-left segmented control: "Static" | "Live".
  In Live mode, drive every bound value from a simulated data source — lamps
  blink, bargraphs fill, trends sweep, an alarm fires after a few seconds.
  Use a `useSimulatedValues` hook with a clean interface so real Modbus/OPC-UA
  values can replace it later.
- Top-right of canvas: toggles for "Show bindings" and "Show grid".
```

---

## Prompt 3 — Intent panel

```
Build the IntentPanel for the left region.

Top — TAG SOURCE
- A drop zone accepting .csv, .txt, .xlsx. On drop, show the filename, a parsed
  count ("247 tags · 2 pumps, 1 tank, 1 flow loop inferred"), and a "View tags"
  link that opens a searchable, virtualised tag list in a slide-over.
- The tag list shows name (monospace), data type as a Badge, address, and a
  binding status dot: green bound, amber unbound.
- Empty state before upload: "Drop a PLC tag export, or start from a description."

Middle — CONVERSATION
- A message thread, but NOT a chatbot UI. No avatars, no bubbles, no typing dots.
- User messages: right-aligned, --bg-elevated, plain.
- Assistant messages: left-aligned, borderless, and they are ACTIONS not prose.
  Each renders as a compact result card:
     ▸ Generated "Pump Station 1"
       3 objects · 7 bindings · 2 warnings          [View] [Undo]
  Keep any prose to a single line. The canvas is the real answer.
- Assistant messages that changed something get a --info left border and a
  "View diff" link.

Bottom — COMPOSER
- Auto-growing textarea, max 6 rows. Enter sends, shift+enter newlines.
- Placeholder: "Describe the screen, or ask for a change…"
- Above it, 3 suggestion chips that change with context. Before generation:
  "Generate screens from these tags" / "Create a pump station screen" /
  "What standards will you apply?". After: "Add an alarm banner" /
  "Make the trend larger" / "Check naming conventions".
- Send button disabled while generating; show a Stop button instead.
```

---

## Prompt 4 — Build timeline

```
Build the BuildTimeline for the bottom region. This is what makes the AI's work
legible — it must read like an engineering log, never like "Thinking…".

A horizontal sequence of steps, scrollable, newest on the right, auto-scrolling.
Each step is a compact card:

  ✓ Parsed tag file        247 tags · 1.2s
  ✓ Inferred equipment     2 pumps, 1 tank, 1 flow loop
  ✓ Matched library        BarGraph_Vert_50, Lamp_Round_24
  ⟳ Binding tags           FT_101.PV → BarGraph.CurrentValue
  ○ Validate
  ○ Package .co

States: pending (hollow circle, --text-muted), running (spinning icon, --info,
subtle pulse), done (check, --ok), warning (triangle, --warn), failed (x, --error).

Behavior:
- Clicking a step highlights every canvas object it produced, using the --info
  glow, and scrolls the inspector to the first of them.
- Hovering shows a popover with the step's detail: inputs, outputs, and for
  library matches, WHY that object was chosen.
- Steps stream in live. The running step shows its current sub-item as changing
  text, so there is always visible motion during generation.
- Collapsed strip mode: a single line showing the running step plus "4/6".

Include a left-hand overall progress ring and elapsed time.
```

---

## Prompt 5 — Inspector

```
Build the Inspector for the right region. Four tabs: Objects, Bindings,
Validation, JSON. The Validation tab label carries a count badge when there are
findings (amber for warnings, red if any errors).

TAB 1 — OBJECTS
- A tree view of the screen JSON: indented rows, expand/collapse chevrons, a type
  icon and the object Name, with SubType in --text-muted.
- Selection is two-way bound with the canvas: selecting here outlines there, and
  vice versa, scrolling the tree row into view.
- Below the tree, a property editor for the selected object, grouped into
  sections (Basic, Appearance, Animation, Layout). Property rows are a label on
  the left and a control on the right: text input, number stepper, color swatch
  that opens a picker, dropdown, or checkbox by type.
- Every property that is bound to a tag shows a small link icon and the tag name
  in monospace instead of a raw value, with a break-link button.
- Editing a property updates the canvas immediately.

TAB 2 — BINDINGS  (see Prompt 6)
TAB 3 — VALIDATION (see Prompt 7)

TAB 4 — JSON
- The selected object's JSON, syntax-highlighted, read-only, monospace.
- A "Diff" switch showing the last change as a red/green line diff.
- A copy button.

EXPLAIN THIS OBJECT — build this as a distinct feature:
An ⓘ button in the property editor header opens a popover answering why the
object exists, in three labelled lines:
   Source     Tags PMP_101_RUN, PMP_101_FLT
   Library    Reused Lamp_Round_24 from the standard library
   Standard   Colour from the site alarm palette; running = green
This is what makes a senior engineer willing to sign the screen off, so give it
real visual weight — don't bury it in a tooltip.
```

---

## Prompt 6 — Binding map

```
Build the BindingMap. This is the highest-value view in the product, because
tag integration is the engineer's biggest pain and today it is invisible until
commissioning. It should also open full-screen from an expand icon.

Two columns with drawn connectors between them:

   TAGS                                    OBJECT PROPERTIES
   ┌────────────────────┐                  ┌────────────────────┐
   │ PMP_101_RUN   BOOL │───────────────▶  │ Lamp_PMP1.State    │
   │ PMP_101_FLT   BOOL │───────────────▶  │ Lamp_PMP1.Alarm    │
   │ FT_101_PV     REAL │───────────────▶  │ BarGraph1.Current  │
   │ LT_101_PV     REAL │  ⚠ unbound       │                    │
   └────────────────────┘                  └────────────────────┘

Paste the mock `bindings` data from the appendix. It has the real shape:
Sources[] and Targets[] joined on ReferenceId.

Requirements:
- Connectors are SVG bezier curves in a layer behind the columns, recalculated on
  scroll and resize.
- Color by state: --ok bound and valid, --warn unbound tag, --error type mismatch
  (e.g. a REAL driving a BOOL input).
- Hovering a row dims every unrelated row and connector to 25% and thickens the
  related ones. This is the moment the view earns its place — make it feel good.
- Clicking a row selects the corresponding canvas object.
- Filter chips above: All / Bound / Unbound / Errors, with counts.
- A search box filtering both columns.
- Drag from an unbound tag to a property to create a binding; show a valid/invalid
  drop indicator based on type compatibility.
- Summary bar at the top: "243 of 247 tags bound · 4 unbound · 1 type mismatch".
```

---

## Prompt 7 — Validation panel

```
Build the ValidationPanel. It lists design-time findings so errors are caught
here rather than at commissioning.

Group findings by severity, errors first, each group collapsible with a count.
A finding row shows:

  ⚠  Naming convention
     "2ND_PUMP" starts with a digit and cannot be imported
     Object: Lamp_Pump2                        [Fix: rename to PUMP_2ND] [Ignore]

Rule categories to represent — these come from EcoStruxure's own documented rules:
- Naming conventions: letters, digits and underscore only; no leading digit; no
  spaces; no reserved words (IEC types like BOOL/INT/DATE_AND_TIME, control codes
  like ACK/BEL/CR, script keywords like class/catch/case/abstract).
- Binding integrity: unbound properties, tags bound to nothing, type mismatches,
  out-of-range scaling.
- Completeness: equipment missing an expected alarm, a trend with no logging, a
  screen with no navigation.
- Standards: colour palette, font sizes, alarm banner placement, resolution fit.

Behavior:
- Clicking a finding selects and scrolls to the offending canvas object.
- "Fix" applies the suggested correction and shows the change as a diff toast.
- "Fix all" on a group, with a confirmation listing what will change.
- A green EmptyState when everything passes: "All checks passed · 12 rules · 247 tags".
- A header button "Export report" producing a printable HTML sign-off report.
```

---

## Prompt 8 — Export and handoff

```
Build the Export modal, opened from the top bar.

Show exactly what will be produced, with file sizes, as a checklist:

  ☑ screens.co          Compound object for EcoStruxure    18 KB
  ☑ variables.csv       Tag definitions, UTF-8 no BOM        9 KB
  ☑ validation.html     Sign-off report                     24 KB

Above the list, a readiness banner:
- green when validation passes: "Ready to import · all checks passed"
- amber with a count when warnings remain, and the Export button reads
  "Export anyway"
- red and Export disabled when there are errors, with a link to the findings.

Below, a numbered "Next steps in EcoStruxure Operator Terminal Expert" card,
because most users will not know the import path:
  1. Open your project in EcoStruxure Operator Terminal Expert
  2. In Project Explorer, select Compound Object Library
  3. Click the import dropdown ▸ Import from File
  4. Select screens.co
  5. For tags: Variables ▸ Import, then choose variables.csv
Each step gets a copy-to-clipboard icon.

Primary action "Download all" as a zip; each row also downloads individually.
After download, show a success state with a "What changed" summary.
```

---

## Prompt 9 — Landing / new project

```
Build the entry screen at route /.

A centered, focused single column, max 640px. No marketing page, no hero image —
this is a tool, and the user wants to start.

  HMI Copilot
  Generate validated HMI screens for EcoStruxure Operator Terminal Expert

  ┌─────────────────────────────────────────────┐
  │   Drop a PLC tag export                     │
  │   .csv, .txt or .xlsx — or click to browse  │
  └─────────────────────────────────────────────┘

  or  [ Start from a description ]   [ Open an example project ]

  Target panel  [ HMIGTO6310 · 1024×768  ▾ ]

Below, a "Recent projects" list — name, target panel, screen count, relative
modified time — that renders an EmptyState on first run.

Dropping a file or choosing an option routes to /workspace with that state
loaded. "Open an example project" loads the mock data fully populated, so the
whole product can be demoed without a backend. Make sure that path works
end-to-end — it is what gets shown to judges.
```

---

## Appendix: Mock data

Paste this alongside Prompts 2 and 6. These are real EcoStruxure shapes, trimmed.

### `screenJson` — a screen definition

```json
{
  "Type": "Screen",
  "UniqueId": "a1000000-0000-4000-8000-000000000001",
  "Name": "PumpStation1",
  "DesignWidth": 1024,
  "DesignHeight": 768,
  "Children": [
    {
      "Type": "Grid",
      "UniqueId": "a1000000-0000-4000-8000-000000000002",
      "Name": "MainGrid",
      "Rows": [{}, {}, {}, {}, {}, {}],
      "Columns": [{}, {}, {}, {}],
      "Children": [
        {
          "Type": "Text",
          "UniqueId": "a1000000-0000-4000-8000-000000000003",
          "Name": "Title",
          "Text": "Pump Station 1",
          "Location": { "Row": 0, "Column": 0, "ColumnSpan": 4 },
          "Colors": { "ForegroundFill": { "Color": { "Value": 15132390 } } }
        },
        {
          "Type": "Lamp",
          "UniqueId": "a1000000-0000-4000-8000-000000000004",
          "Name": "Lamp_PMP1",
          "Label": "PMP 1 RUN",
          "State": false,
          "Location": { "Row": 1, "Column": 0 },
          "Colors": {
            "OnFill":  { "Color": { "Value": 4046168 } },
            "OffFill": { "Color": { "Value": 5723991 } }
          }
        },
        {
          "Type": "Lamp",
          "UniqueId": "a1000000-0000-4000-8000-000000000005",
          "Name": "Lamp_PMP2",
          "Label": "PMP 2 RUN",
          "State": false,
          "Location": { "Row": 1, "Column": 1 },
          "Colors": {
            "OnFill":  { "Color": { "Value": 4046168 } },
            "OffFill": { "Color": { "Value": 5723991 } }
          }
        },
        {
          "Type": "BarGraph",
          "UniqueId": "a1000000-0000-4000-8000-000000000006",
          "Name": "BarGraph_Flow",
          "SubType": "BarGraph_Vert_50",
          "CurrentValue": 75,
          "Min": 0,
          "Max": 250,
          "Unit": "LPM",
          "Location": { "Row": 1, "Column": 2, "RowSpan": 3 },
          "Colors": {
            "ForegroundFill": { "Color": { "Value": 45136 } },
            "BorderFill":     { "Color": { "Value": 34342 } },
            "BackgroundFill": { "Value": 14277081, "Transparency": 75 }
          },
          "Animation": {
            "FillLevel": {
              "Enable": true,
              "VerticalFill": 30,
              "BackColor": { "Value": 14277081, "Transparency": 75 }
            }
          }
        },
        {
          "Type": "TrendGraph",
          "UniqueId": "a1000000-0000-4000-8000-000000000007",
          "Name": "Trend_Flow",
          "Location": { "Row": 2, "Column": 0, "RowSpan": 2, "ColumnSpan": 2 },
          "Pens": [
            { "Name": "FT_101_PV", "Color": { "Value": 45136 },  "Min": 0, "Max": 250 },
            { "Name": "LT_101_PV", "Color": { "Value": 3906303 }, "Min": 0, "Max": 100 }
          ]
        },
        {
          "Type": "NumericDisplay",
          "UniqueId": "a1000000-0000-4000-8000-000000000008",
          "Name": "Num_Level",
          "Value": 62.4,
          "Unit": "%",
          "Decimals": 1,
          "Location": { "Row": 4, "Column": 0 }
        },
        {
          "Type": "AlarmSummary",
          "UniqueId": "a1000000-0000-4000-8000-000000000009",
          "Name": "AlarmBanner",
          "Location": { "Row": 5, "Column": 0, "ColumnSpan": 4 },
          "Rows": [
            { "Time": "10:42:17", "Tag": "LT_101_PV", "Text": "HIGH LEVEL", "Severity": "warn" }
          ]
        }
      ]
    }
  ]
}
```

### `tags` — parsed PLC tag list

```json
[
  { "name": "PMP_101_RUN", "dataType": "BOOL", "address": "%MX0.0", "scanRate": "Normal", "comment": "Pump 1 running",  "bound": true },
  { "name": "PMP_101_FLT", "dataType": "BOOL", "address": "%MX0.1", "scanRate": "Normal", "comment": "Pump 1 fault",    "bound": true },
  { "name": "PMP_102_RUN", "dataType": "BOOL", "address": "%MX0.2", "scanRate": "Normal", "comment": "Pump 2 running",  "bound": true },
  { "name": "PMP_102_FLT", "dataType": "BOOL", "address": "%MX0.3", "scanRate": "Normal", "comment": "Pump 2 fault",    "bound": false },
  { "name": "FT_101_PV",   "dataType": "REAL", "address": "%MD10",  "scanRate": "Fast",   "comment": "Flow LPM",        "bound": true },
  { "name": "LT_101_PV",   "dataType": "REAL", "address": "%MD14",  "scanRate": "Fast",   "comment": "Tank level %",    "bound": true },
  { "name": "LT_101_HI",   "dataType": "BOOL", "address": "%MX2.0", "scanRate": "Normal", "comment": "High level",      "bound": true },
  { "name": "SPARE_01",    "dataType": "INT",  "address": "%MW20",  "scanRate": "Slow",   "comment": "",                "bound": false }
]
```

### `bindings` — the Sources → Targets graph

```json
{
  "Sources": [
    { "ReferenceId": 0, "Tag": "PMP_101_RUN", "DataType": "BOOL" },
    { "ReferenceId": 1, "Tag": "PMP_101_FLT", "DataType": "BOOL" },
    { "ReferenceId": 2, "Tag": "PMP_102_RUN", "DataType": "BOOL" },
    { "ReferenceId": 3, "Tag": "FT_101_PV",   "DataType": "REAL" },
    { "ReferenceId": 4, "Tag": "LT_101_PV",   "DataType": "REAL" },
    { "ReferenceId": 5, "Tag": "LT_101_HI",   "DataType": "BOOL" }
  ],
  "Targets": [
    { "ReferenceId": 0, "ObjectId": "a1000000-0000-4000-8000-000000000004", "ObjectFullName": "Lamp_PMP1",      "PropertyFullName": "State",        "status": "ok" },
    { "ReferenceId": 1, "ObjectId": "a1000000-0000-4000-8000-000000000004", "ObjectFullName": "Lamp_PMP1",      "PropertyFullName": "Alarm",        "status": "ok" },
    { "ReferenceId": 2, "ObjectId": "a1000000-0000-4000-8000-000000000005", "ObjectFullName": "Lamp_PMP2",      "PropertyFullName": "State",        "status": "ok" },
    { "ReferenceId": 3, "ObjectId": "a1000000-0000-4000-8000-000000000006", "ObjectFullName": "BarGraph_Flow",  "PropertyFullName": "CurrentValue", "status": "ok" },
    { "ReferenceId": 4, "ObjectId": "a1000000-0000-4000-8000-000000000008", "ObjectFullName": "Num_Level",      "PropertyFullName": "Value",        "status": "ok" },
    { "ReferenceId": 5, "ObjectId": "a1000000-0000-4000-8000-000000000009", "ObjectFullName": "AlarmBanner",    "PropertyFullName": "Trigger",      "status": "ok" }
  ]
}
```

### `timeline` — build steps

```json
[
  { "id": 1, "label": "Parsed tag file",   "detail": "247 tags",                          "status": "done",    "ms": 1200 },
  { "id": 2, "label": "Inferred equipment","detail": "2 pumps, 1 tank, 1 flow loop",      "status": "done",    "ms": 2400 },
  { "id": 3, "label": "Matched library",   "detail": "BarGraph_Vert_50, Lamp_Round_24",   "status": "done",    "ms": 800  },
  { "id": 4, "label": "Binding tags",      "detail": "FT_101_PV → BarGraph.CurrentValue", "status": "running", "ms": null },
  { "id": 5, "label": "Validate",          "detail": null,                                 "status": "pending", "ms": null },
  { "id": 6, "label": "Package .co",       "detail": null,                                 "status": "pending", "ms": null }
]
```

### `validations` — findings

```json
[
  { "severity": "error", "category": "Naming convention", "message": "\"2ND_PUMP\" starts with a digit and cannot be imported", "objectId": "a1000000-0000-4000-8000-000000000005", "fix": "Rename to PUMP_2ND" },
  { "severity": "warn",  "category": "Binding integrity", "message": "PMP_102_FLT is not bound to any object",                  "objectId": null,                                    "fix": "Add a fault lamp for Pump 2" },
  { "severity": "warn",  "category": "Completeness",      "message": "Trend_Flow has no data logging configured",               "objectId": "a1000000-0000-4000-8000-000000000007", "fix": "Enable logging at 1s" },
  { "severity": "info",  "category": "Standards",         "message": "Alarm banner placed at the bottom; site standard is top", "objectId": "a1000000-0000-4000-8000-000000000009", "fix": "Move to row 0" }
]
```

---

## Build order

Fastest path to something demoable:

1. Prompt 0 — foundation
2. Prompt 9 — landing, with "Open an example project" wired to the mock data
3. Prompt 1 — workspace shell
4. Prompt 2 — **the canvas**; once this renders the mock screen, the demo exists
5. Prompt 4 — timeline, for the streaming effect
6. Prompt 6 — binding map, the strongest single view
7. Prompts 3, 5, 7, 8 — intent, inspector, validation, export

If time runs short, 0 → 9 → 1 → 2 → 4 is a complete, convincing demo on its own.
