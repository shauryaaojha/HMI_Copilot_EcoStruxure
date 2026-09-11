# How all of this actually works

A field guide to HMI Copilot, written for someone who has never worked with
industrial control software and has never written a web application.

Nothing here assumes prior knowledge. Every term is defined the first time it
appears, with a real example taken out of this repository. If you already know
what a PLC tag is, skip to Part 3. If you already know what React is, skip Part
4.5.

There is a glossary at the end (Part 8) with every term in alphabetical order.

**Contents**

| Part | What it covers |
|---|---|
| 1 | The world this lives in: plants, PLCs, tags, panels, and what an HMI engineer does all day |
| 2 | EcoStruxure Operator Terminal Expert, and the two halves called Buildtime and RunTime |
| 3 | The `.eote` project file, opened up and explained byte by byte |
| 4 | How our application is built: the web stack from zero, then the real architecture |
| 5 | One sentence becoming a project, traced end to end with real data |
| 6 | What happens after generation: editing, conversation, validation, simulation, export |
| 7 | What is not built, stated plainly |
| 8 | Glossary |

---

# Part 1 · The world this lives in

## 1.1 A plant, and the things in it

Start with a physical place: a water treatment works, a boiler house, a bottling
line, a chemical plant. Call it a **plant**. It is full of equipment that does
physical work: pumps that move liquid, valves that let it through or stop it,
motors that turn things, fans that move air, tanks that hold product, filters
that clean it.

Scattered among that equipment are **instruments**, which are devices that
measure something and report a number: a flow transmitter that says how many
litres per minute are passing, a level transmitter that says how full a tank is,
a pressure transmitter, a temperature probe.

So a plant is two kinds of thing: machines that act, and instruments that
measure. Everything else in this document is about how a person sees and
controls those two categories from a room somewhere else.

## 1.2 What a PLC is

A **PLC** stands for **Programmable Logic Controller**. It is a small,
industrially hardened computer that is wired directly to the equipment. It is
not a general purpose computer: it has no monitor, it runs one program forever,
and it is built to keep running for twenty years in a hot cabinet.

The PLC does two jobs:

1. **It reads inputs.** A wire from the pump's motor starter tells it whether
   the pump is actually running. A wire from the flow transmitter carries a
   signal that represents 0 to 500 litres per minute.
2. **It writes outputs.** A wire back to the motor starter tells the pump to
   start. A wire to a valve tells it to open.

Between the two it runs a control program, over and over, typically tens or
hundreds of times per second. That program is the plant's logic: "if the tank
level is above 85 percent, stop the inlet pump."

**The PLC is not the thing a human looks at.** It has no screen. Everything it
knows lives in its memory, in numbered locations. Which brings us to tags.

## 1.3 What a tag is

Inside the PLC's memory, every value has an address, something like `%MW100` or
`%IX2.3`. Nobody wants to work with those, so every meaningful address is given
a name. **That name, together with its data type and its address, is a tag.**

A tag is exactly three things:

| Part | Example | Meaning |
|---|---|---|
| **Name** | `PMP_101_RUN` | what a human calls it |
| **Data type** | `BOOL` | what kind of value it holds |
| **Address** | `%MX10.0` | where in the PLC's memory it lives |

Usually there is a fourth: a **comment**, a free text description like `Pump 101
running feedback`.

### Decoding `PMP_101_RUN`

Tag names are not arbitrary. Plants follow naming conventions, most of them
descended from a standard called **ISA-5.1** (the instrumentation naming
standard published by the International Society of Automation). A typical name
has three parts:

```
PMP _ 101 _ RUN
 |     |     |
 |     |     +-- ROLE:   what this particular value is about
 |     +-------- LOOP:   which control loop / which unit of equipment
 +-------------- PREFIX: what kind of thing it is
```

So `PMP_101_RUN` reads as: **the running feedback bit of pump number 101**. Its
data type is `BOOL`, meaning a single true/false bit. True means the pump is
turning.

Now look at a whole set of names from one real plant area:

| Tag | Type | Decoded |
|---|---|---|
| `PMP_101_RUN` | BOOL | Pump 101, running feedback |
| `PMP_101_FLT` | BOOL | Pump 101, fault (it has tripped) |
| `PMP_102_RUN` | BOOL | Pump 102, running feedback |
| `PMP_102_FLT` | BOOL | Pump 102, fault |
| `FT_101_PV` | REAL | Flow Transmitter on loop 101, Process Value (the live reading) |
| `LT_101_PV` | REAL | Level Transmitter on loop 101, Process Value |
| `LT_101_HI` | BOOL | Level Transmitter on loop 101, high level switch |

Two things worth noticing, because the whole product depends on them.

**First, the prefix tells you what kind of thing it is.** `PMP` is a pump. `FT`
is a flow transmitter, because in ISA-5.1 the first letter of an instrument tag
says what is measured: `F` flow, `L` level, `P` pressure, `T` temperature, `A`
analysis, `S` speed. The second letter `T` means transmitter.

**Second, the loop number binds them together.** `PMP_101_RUN` and `FT_101_PV`
share the number 101, and that is not a coincidence. The flow transmitter on
loop 101 is measuring what pump 101 is doing. A human engineer reads that
instantly. So can a program, and that is precisely what `web/src/lib/ai/infer.ts`
does: it splits every tag name into prefix, loop and role, and groups the
tags that share a loop into one piece of equipment.

### Data types

The data type says how many bits the value occupies and how to read them. The
ones EcoStruxure supports, and which this product therefore supports, are the
**IEC 61131-3** types (the international standard for PLC programming
languages):

| Type | Meaning | Typical use |
|---|---|---|
| `BOOL` | one bit, true or false | running, fault, valve open |
| `INT` / `DINT` | 16-bit / 32-bit signed whole number | counts, step numbers |
| `UINT` / `UDINT` | unsigned whole numbers | counters that never go negative |
| `WORD` / `DWORD` | 16-bit / 32-bit bit patterns | status words, packed flags |
| `REAL` / `LREAL` | 32-bit / 64-bit decimal numbers | flow, level, temperature |
| `STRING` | text | batch names, recipe ids |

The distinction that matters most in this product is **BOOL versus everything
numeric**. A BOOL can drive a lamp (on or off). A REAL cannot: it has to drive
a numeric display or a bar graph. Wiring a REAL to a lamp is a real mistake that
real engineers make, and one of our validation rules exists specifically to
catch it.

### The tag list is a file

At the start of an HMI project, the PLC programmer hands the HMI engineer an
**export**: a spreadsheet or CSV file with one row per tag. That file is the
input to everything this product does. Here are the first rows of a real one
from this repository, `web/public/demo/Transfer_Pumps.csv`:

```
Name,DataType,Comment,Address
PMP_101_RUN,BOOL,Transfer pump 101 running,%MX10.0
PMP_101_FLT,BOOL,Transfer pump 101 fault,%MX10.1
FT_101_PV,REAL,Transfer pump 101 discharge flow LPM,%MD200
```

A small plant hands over 200 tags. A large one hands over several thousand. The
water treatment export committed in this repository has **1,248**.

## 1.4 What an HMI is, and what a panel is

**HMI** stands for **Human Machine Interface**. It is the screen an operator
looks at to see what the plant is doing and to tell it to do something.

Physically it is usually a **panel**: a ruggedised touchscreen computer bolted
into the door of a control cabinet on the plant floor, or mounted on a wall in
a control room. It has no keyboard. It is often the only thing in the room with
a screen. It runs one application forever and is never rebooted if anyone can
help it.

A concrete example: the panel this project targets by default is a Schneider
model whose identifier is `HMIST6500AWADI`, and its screen is **1024 by 600
pixels**. Those two facts are read out of the project file itself (see Part 3.5),
not typed into our application, because a screen laid out for the wrong
resolution is a screen that does not fit.

The HMI displays a set of **screens** (also called displays, mimics, or pages).
A typical HMI application has between about a dozen and sixty of them: a plant
overview, a screen per area, detail screens, an alarm screen, trend screens,
and navigation buttons connecting them.

The related word **SCADA** (Supervisory Control And Data Acquisition) means
roughly the same idea at a larger scale: a PC based system supervising many
PLCs across a whole site, rather than one panel watching one machine. This
product targets the panel HMI, not SCADA, but the vocabulary is shared.

## 1.5 What an HMI engineer actually does all day

Here is the job, concretely, in the order it happens.

**1. Receive the tag list.** A CSV or spreadsheet with a few hundred to a few
thousand rows arrives from the PLC programmer.

**2. Create a project in the engineering tool** and declare every tag in it.
The HMI has its own copy of the tag list: each tag is entered with its name,
data type, and the address in the PLC where the value will be read from.
Hundreds of rows, typed or imported and then corrected.

**3. Draw the screens.** Open a blank canvas the size of the panel. Drag a
rectangle for a panel background. Drag a text box and type "PUMP 1". Drag a
lamp object and position it. Drag another. Drag a numeric display for the flow
reading. Drag a bar graph for the level. Set the fonts, the sizes, the colours,
the alignment. Repeat for the second pump. Repeat for the next screen, and the
next, and the next.

**4. Bind everything.** This is the part that costs the most and is the least
visible. For every object drawn, open its properties and connect one of its
properties to one of the tags. The lamp's `CurrentValue` property has to be
connected to `PMP_101_RUN`. The numeric display's `CurrentValue` has to be
connected to `FT_101_PV`. That connection is called a **binding**. On a
250-object project there are a few hundred of them, all made by hand, one dialog
box at a time.

**5. Configure alarms.** Decide which conditions the operator must be told about
and how loudly: pump fault, tank level high, tank level critically high. Each
alarm gets a message, a severity, and a trigger, which is the tag whose change
raises it.

**6. Check it.** Look at every screen. Look for the lamp that is bound to the
wrong pump. Look for the numeric display that is bound to nothing and therefore
shows a constant zero forever.

**7. Commission.** Take a laptop to site, download the project to the physical
panel, connect it to the real PLC, and find out what is wrong. This is the
expensive step. An error found here costs a site visit; the same error found at
step 6 costs thirty seconds.

## 1.6 Why this is slow and error-prone

Four things, and they compound.

| Problem | What it looks like in practice |
|---|---|
| **Manual screen development** | Forty near-identical equipment screens, each hand-placed. The fortieth is not identical to the first, because a human drew it. |
| **Expert-driven configuration** | Only the senior engineer knows which object type, which animation, and which colour standard to use. Juniors block on them for hours. |
| **Complex tag integration** | Several hundred bindings made by hand. A binding that points at pump 2's flow under pump 1's label looks completely normal on screen. |
| **Inconsistency** | Two engineers on one project produce two differently-shaped, differently-named HMIs. |

The failure mode that matters is the third one. **A wrong binding is invisible.**
The screen looks right. The number moves. It is simply the wrong number, and
nobody finds out until commissioning, or worse, until an operator makes a
decision based on it during an upset.

That is the problem this product exists to remove: not to draw prettier screens,
but to make the wiring correct by construction and visible before anyone drives
to site.

---

# Part 2 · EcoStruxure Operator Terminal Expert

## 2.1 What the product is

**EcoStruxure Operator Terminal Expert**, abbreviated **OTE** in this document
and in the code, is Schneider Electric's engineering software for building HMI
applications for their panels. This project targets **version 4.4**, which is
Windows only.

It is one installed product, but it contains two entirely separate programs, and
the difference between them comes up constantly.

## 2.2 Buildtime: the design tool

**Buildtime** is the engineering application. It runs on an engineer's Windows
PC. It is where the work described in Part 1.5 happens: declaring tags, drawing
screens, making bindings, configuring alarms. It is a desktop application with
menus, a canvas, a property inspector and a toolbox of drawable objects.

**Buildtime never touches the plant.** It produces a file. That is the entire
output of the engineer's week: one project file.

Its technical stack matters to us, so it is worth being exact. Buildtime is a
**hybrid**: a .NET / C# shell with native Qt5 / C++ modules underneath it.

- **.NET** is Microsoft's application runtime; **C#** is the language most
  commonly written for it. The evidence in the installation is the presence of
  `*.deps.json` dependency manifests, Entity Framework Core (a .NET database
  layer), Roslyn (the C# compiler, embedded for scripting), and
  `Microsoft.Data.Sqlite`.
- **Qt5** is a large C++ framework for building desktop user interfaces.
  Evidence: `Qt5Core_x64.dll` and friends sitting in the same folder.

Two consequences of that hybrid stack:

1. **There is no way for us to extend it directly.** Writing a plugin would need
   a software development kit Schneider does not publish, plus code signing.
2. **It ships with an embedded web browser.** Among the Qt5 libraries is
   `Qt5WebEngine`, which is Chromium, the same engine inside Google Chrome. That
   fact becomes important in Part 4 and in the pitch: an interface built as a
   web page can later be docked inside the product without introducing any
   technology the product does not already carry.

## 2.3 RunTime: the thing on the wall

**RunTime** is the completely different program that executes on the physical
panel on the plant floor. It reads the project file Buildtime produced, connects
to the PLC, and draws the screens. It is what the operator stares at.

Its stack is pure **C++ / Qt5 with embedded Lua** (Lua being a small scripting
language commonly embedded in applications). Evidence in the installation:
`PCPlatform.exe`, `Platform.dll`, `CoreDriver.dll`, the `Qt5*.dll` family, and
`INIT.luac`, which is compiled Lua bytecode.

### The distinction, made vivid

| | Buildtime | RunTime |
|---|---|---|
| Where it runs | An engineer's Windows PC, in an office | The panel, bolted to a cabinet in the plant |
| Who uses it | An HMI engineer, for a week | An operator, for ten years |
| What it does | Lets you draw and configure | Executes: reads the PLC, draws, alarms |
| Stack | .NET / C# shell + Qt5 / C++ modules | C++ / Qt5 + Lua |
| Failure mode | Annoying | In an emergency, someone reads the wrong number |

**Buildtime is the design tool. RunTime is the thing the operator stares at
during an emergency at three in the morning.** Everything about the safety
posture in this project comes from taking the second sentence seriously.

## 2.4 Where our product meets theirs

HMI Copilot does not modify Buildtime and does not modify RunTime. It produces
the file that sits between them. That is called meeting at the **artifact
boundary**: we write the artifact (the project file), and the existing product
reads it exactly as it would read a file one of its own engineers had saved.

```
   HMI Copilot                     BOUNDARY                    EcoStruxure OTE
   (Next.js / TypeScript)     (a file on disk)             (C# / C++ / Qt / Lua)
        |                            |                              |
   generated JSON  --------->  project.eote  ---> File > Open Project ---> a built HMI
```

The boundary is language agnostic. A file does not care what wrote it. That
single decision is why this project works at all, and Part 3 is the explanation
of why the boundary turned out to be crossable.

## 2.5 One licensing fact worth knowing early

Some features of Buildtime are gated behind licence tiers. In particular,
creating a **compound object** (a reusable group of parts, saved as a `.co` file
and dragged onto screens later) is licence-gated: an unlicensed installation
shows "The current license does not support creation/modification of compound
objects."

Placing ordinary parts directly onto a screen is **not** gated. That is one of
the reasons this product generates whole projects with parts placed directly on
screens, rather than generating compound objects to be imported. There is also a
simpler reason: **screens cannot be imported into OTE at all.** The product ships
import/export documentation for compound objects, variables, alarms, recipes,
logging, language and security, and for screens there is nothing. So if you want
a finished screen, generating the whole project is not one option among several.
It is the only route.

---

# Part 3 · The `.eote` file, opened up

Everything Buildtime produces is one file whose name ends in `.eote`. This part
explains exactly what is inside it. First, three background technologies, each
in a paragraph.

## 3.1 What a ZIP is

A **ZIP** file is a container: many files packed into one, usually compressed. A
`.docx` Word document is a ZIP. A `.jar` Java program is a ZIP. Inside, each
packed file is called an **entry**, and every entry has a name that includes its
folder path, for example `Screens/abc-123/Screen.dat`.

`.eote` is a ZIP. Rename one to `.zip`, open it, and its contents are simply
there. There is no encryption and no digital signature, which we know both by
inspection and because every project's `_metadata` records
`"EncryptionInfo": null, "SignatureInfo": null`.

## 3.2 What JSON is

**JSON** stands for JavaScript Object Notation. It is a plain text format for
structured data. Two shapes: an object, written with braces and made of
`"key": value` pairs, and an array, written with square brackets and holding a
list. Values are text, numbers, true/false, null, or more objects and arrays.

```json
{
  "Type": "Lamp",
  "Name": "Lamp_PMP101_RUN",
  "Location": { "Left": 24, "Top": 118 },
  "Width": 142,
  "Height": 44
}
```

That is a real object out of a generated screen. It is readable, it is
diffable, and any program can produce it. Being able to say "the screen is
JSON" is most of what makes this project possible.

## 3.3 What SQLite is

**SQLite** is a complete relational database that lives in a single ordinary
file. No server, no installation, no network. It stores tables of rows and
columns, and it is queried with **SQL**, the standard database language:
`SELECT Name, DataType FROM Variables`.

It is the most widely deployed database in the world: it is inside every phone,
every browser, and a great many desktop applications. EcoStruxure uses it for
the parts of a project that are naturally tabular, above all the tag list and
the alarm list.

We read and write these files in the browser stack using **sql.js**, which is
SQLite compiled to **WebAssembly** (a portable binary format that runs inside
JavaScript environments). That matters practically: it means our packager has no
native compiled dependency and runs anywhere Node.js runs.

## 3.4 The anatomy

Here is what is actually inside an `.eote`, established by unpacking the
template projects the product itself ships at
`Buildtime\BuildtimeData\ProjectTemplates` (a blank project, two demos and three
samples).

```
<project>.eote                       ZIP  (nested entry names use BACKSLASHES)
 |
 +-- Project.dat                     JSON    project identity, version, ids
 +-- Target.dat                      JSON    which panel model, what resolution
 +-- Variables.db                    SQLite  the tag list
 +-- Alarm.db                        SQLite  alarm groups and alarms
 +-- Bindings.dat                    JSON    Sources -> Bindings -> Targets graph
 +-- Recipe.db                       SQLite  recipes
 +-- Security.db                     SQLite  users and permissions
 +-- Language.db                     SQLite  translations
 +-- DriverConfig.db                 SQLite  how to talk to the PLC
 +-- GlobalScripts.dat               JSON    project-wide scripts
 +-- Contents\Hierarchy.dat          JSON    content ordering
 +-- Screens\Hierarchy.dat           JSON    which screens exist, in what order
 +-- Screens\<guid>\
      +-- Screen.dat                 JSON    the object tree for one screen
      +-- Metadata.dat               JSON    that screen's name, id and order
      +-- LocalVariables.db          SQLite  variables scoped to that screen
```

`<guid>` is a **GUID** (Globally Unique Identifier), a 128-bit random
identifier written as `3f2504e0-4f89-11d3-9a0c-0305e82c3301`. GUIDs are used
throughout the format so that any two objects, created anywhere at any time, can
be told apart without a central registry.

Our packager, `web/src/lib/ote/packager.ts`, writes the five bold entries below
and copies every other entry through **verbatim** from a skeleton extracted out
of a licensed installation:

| Entry | What we do |
|---|---|
| **`Variables.db`** | delete every row, insert one row per tag |
| **`Alarm.db`** | delete every row, insert one group and one row per alarm |
| **`Screens\<guid>\*`** | write fresh, one folder per screen |
| **`Screens\Hierarchy.dat`** | write fresh, listing the screens in order |
| **`Bindings.dat`** | write fresh, the whole binding graph |
| `Project.dat` | copy, then stamp new ids and a modified timestamp |
| everything else | copy, byte for byte, untouched |

That "copy, untouched" column is a deliberate design position, not laziness. We
do not attempt to synthesise the security model or the recipe schema. We start
from a real project the product itself wrote, and we change only what we
understand.

## 3.5 `Project.dat` and `Target.dat`

`Project.dat` is the project's identity: its name, its unique id, the version of
OTE that last wrote it, timestamps. The packager takes the skeleton's copy,
assigns new ids, sets `VersionModified` to `4.4.0.0`, and writes it back.

`Target.dat` says which physical panel the project is for. It contains a
`TargetInfo` object with, among other fields, a `RuntimeModel` (for example
`HMIST6500AWADI`) and a `Resolution` (for example `1024 x 600`).

**`Target.dat` is the authority, not our application.** The function `readPanel`
in `packager.ts` parses the resolution string out of it, and `/api/panel`
serves it to the interface so the label an engineer reads is the file's own
truth rather than a caption typed into a component. If the project our
application thinks it is building disagrees with what the file targets, that
disagreement is reported as a validation warning rather than silently ignored
or fatally thrown.

## 3.6 `Variables.db`: the tags

A single SQLite table called `Variables`, one row per tag. The columns that
matter:

| Column | Example | Meaning |
|---|---|---|
| `UniqueId` | `A1B2C3D4-...` (uppercase GUID) | this tag's identity, referenced by bindings |
| `Name` | `PMP_101_RUN` | the tag name |
| `DataType` | `BOOL` | the IEC type |
| `InitialValue` | `false` | value before the PLC connects |
| `Comments` | `Transfer pump 101 running` | free text |
| `DeviceAddress` | `%MX10.0` | where to read it from |
| `Order` | `1` | display order in the tag editor |

Writing it is not complicated but it does have one trap that cost this project a
day once, and it is worth stating because it is the sort of thing that produces
silently wrong output rather than an error.

> **Quote every column name in SQL.** `Order` and `Value` are SQL keywords.
> SQLite resolves an unknown double-quoted identifier as a **string literal**
> rather than raising an error. So a mistake does not crash; it writes the word
> `SetPoint` into every setpoint cell and looks fine until someone reads the
> data. `web/src/lib/ote/databases.ts` quotes every column, and it takes the
> column list from the table itself with `pragma table_info` rather than from a
> hardcoded list, so it writes exactly the columns this version of the product
> defines.

## 3.7 `Alarm.db`: what the operator gets told

Two tables: `AlarmGroup` (a container, we write one, named `AlarmGroup1`), and
`Alarm`, one row per alarm.

An alarm has:

| Field | Values | Meaning |
|---|---|---|
| `Message` | `"Pump 101 fault"` | what the operator reads |
| `Severity` | 1 to 9 | how urgent |
| `AlarmRecordType` | 1 or 2 | **1 = bit alarm**, **2 = level alarm** |
| `AlarmType` | 1 to 4 | HiHi, Hi, Lo, LoLo |
| `Value` | `"85"` | the threshold, for a level alarm |

The **bit versus level** distinction is the important one:

- A **bit alarm** watches a BOOL. When `PMP_101_FLT` goes true, the alarm is
  active. `Value` is not meaningful.
- A **level alarm** watches a number against a threshold. When `LT_101_PV` rises
  above `85`, the alarm is active. The threshold is the **alarm setpoint**.

`AlarmType` labels which threshold it is. A tank level typically gets a pair:
`Hi` at 85 (warn) and `HiHi` at 95 (act). Our inference proposes exactly that
pair for any numeric level reading, because that is what a tank always has.

Notice what is **not** in the `Alarm` table: there is no column naming the tag
that triggers the alarm. That connection is a binding, which is the next
section, and it is why the simulation engine recovers alarm triggers by walking
the binding list rather than by reading a field.

## 3.8 `Screen.dat`: the picture

One JSON file per screen. The structure is a tree exactly three levels deep in
practice:

```
Screen              the screen itself, with a Name and a UniqueId
  └── ViewBox       the drawable area, sized to the panel
        ├── Rectangle
        ├── TextBox
        ├── Lamp
        ├── NumericDisplay
        └── AlarmSummary          ... and so on, one entry per drawn object
```

A **ViewBox** is the drawing surface: it has a `Width` and a `Height` that match
the panel resolution, and its `Children` array holds every object on the screen.

Each child is a **part**, which is the product's word for a drawable object
type. Every part carries at minimum:

```json
{
  "Type": "NumericDisplay",
  "UniqueId": "b7f1c8a2-...",
  "Name": "Num_FT101PV",
  "Location": { "Left": 144, "Top": 152 },
  "Width": 124,
  "Height": 30
}
```

`Location` is the top-left corner in screen units, measured from the top-left of
the ViewBox. Positioning is **absolute**: no flow layout, no automatic
arrangement. Everything sits exactly where it was put. That is a direct match
for how we render it in the browser, which is Part 4.7.

### Palette indices, not colours

A colour on an EcoStruxure screen is not a red-green-blue value. It is an
**index into the project's colour set**:

```json
"Fill": { "Color": { "Value": 3 } }
```

Index 3 in colour set 4, "Green-Simple", is `#00b050`. The full sixty-colour
table was read out of the product's own
`Buildtime/CommonScripts/Colors/Colors.lua` and lives in
`web/src/lib/ote/palette.ts`, where the ten indices the generator uses are given
names so the code reads as intent:

```ts
export const INK = 1;         // #f1f1f1 is PAPER, 2
export const GREEN = 3;       // running
export const AMBER = 4;
export const RED = 5;         // fault
export const GREY = 11;
export const WHITE = 21;
export const DARK_GREY = 22;
export const DARK_GREEN = 43;
```

This has a consequence that shows up in the live demo. **Our application's own
light/dark theme does not and cannot theme the HMI screen**, because the screen's
colours are indices resolved through the project's palette. Toggle the theme in
the top bar and the application chrome changes while the HMI screen sits there
unchanged. That is not a limitation; it is the proof that the preview is showing
the file rather than a styled picture of it. There is a test asserting the
rendered screen contains no application design token and only palette hex.

### The six parts this product emits

OTE ships fifty part types, and the shipped sample projects use all fifty; one
real example of each was captured into `reference/part_examples.json`. This
product currently generates six of them:

| Part | What it draws | Bound property |
|---|---|---|
| `Rectangle` | a filled, bordered box: panels, chips, bands | none |
| `TextBox` | static text: titles, labels, units | none |
| `Lamp` | a two-state indicator; it carries **both** faces in the JSON (`Off` and `On`), and the bound tag chooses between them | `CurrentValue` |
| `NumericDisplay` | a live number with a decimal-digit setting | `CurrentValue` |
| `AlarmSummary` | the product's own active-alarm grid | none, it reads the alarm system |
| `Path` | one of the 474 shipped graphic symbols, as vector geometry | none |

Six is a deliberate number and not an apology. Everything on a generated screen,
including things that look like buttons or navigation tabs, is built from these
six, because `Screen.dat` has no button part: a navigation chip on a hand-built
OTE screen is also a Rectangle with a TextBox on top of it.

### The `Path` part and the shipped symbol library

The product ships **475 graphic objects** at
`Buildtime\PropertyDefinitions\ScreenDesign\GraphicObjects\`, organised into
categories: Pumps, Tanks, Valves, Pipes, Fans, Air Compressors, Arrows, and
more. Each is a small JSON file:

```json
{
  "Name": "Pump01",
  "Commands": "MLLLLLLLLLLzMLLLLz...",
  "Points": "0,2502,166,2502,620,2502,..."
}
```

`Commands` is a string of drawing commands (`M` move to, `L` line to, `Q`
quadratic curve, `C` cubic curve, `z` close path). `Points` is the flat list of
coordinates those commands consume, in order. Zipping the two together produces
an SVG path directly, and that is what `web/src/lib/ote/graphics.ts` does. Our
indexer converts **474 of the 475** with no geometry errors.

The index deliberately keeps `Commands` and `Points` alongside the derived SVG
path, because a `Path` part in a project stores the original two. An index that
kept only the derived form could be browsed but never placed. In the Library
panel, a symbol lacking them is shown greyed with the reason rather than being
placed as something the export could not contain.

## 3.9 `Bindings.dat`: the wiring, with a worked example

This is the file that does the work Part 1.5 step 4 describes, and it is where
several days of an engineer's project go.

A **binding** is a connection: *this tag drives that property of that object.*

`Bindings.dat` holds three arrays that reference each other by position:

```json
{
  "Sources":  [ { "ObjectType": 4,  "ReferenceId": 0, "ObjectId": "<tag GUID>",  "ObjectFullName": "PMP_101_RUN" } ],
  "Targets":  [ { "ObjectType": 8,  "SubType": "Lamp", "ReferenceId": 0,
                  "ObjectId": "<part GUID>", "ScreenId": "<screen GUID>",
                  "ParentIds": "<SCREEN GUID UPPERCASE>", "ObjectFullName": "Lamp_PMP101_RUN" } ],
  "Bindings": [ { "Type": 2, "Mode": 2, "BindingText": "PMP_101_RUN.Value",
                  "Target": 0, "TargetProperty": "CurrentValue", "Sources": "0" } ]
}
```

Read that as a sentence: **binding 0 connects source 0 (the tag `PMP_101_RUN`)
to target 0 (the lamp `Lamp_PMP101_RUN`) at its property `CurrentValue`.**

`ObjectType` says what kind of thing each end is: **4 = variable, 8 = screen
part, 30 = alarm**. One source is written per tag no matter how many things it
drives, which is why `Sources` is deduplicated and `Targets` is not.

### Two shapes, and they are genuinely different

| | Display binding | Alarm binding |
|---|---|---|
| Target `ObjectType` | 8 (a screen part) | 30 (an alarm) |
| Target `SubType` | the part type, e.g. `Lamp` | `BoolAlarm` or `LevelAlarm` |
| `TargetProperty` | `CurrentValue` | `VariableName` |
| `BindingText` | `PMP_101_RUN.Value` (with the suffix) | `PMP_101_FLT` (bare) |
| `Mode` | 2 | 1 |

Getting the `.Value` suffix wrong, or the mode, produces a project that opens
and displays nothing. Both shapes were established by reading real bindings out
of the shipped sample projects, not by guessing.

### Why `ScreenId` on a target matters

A target carries both a `ScreenId` and a `ParentIds`. In a single-screen project
you can get away with anchoring everything to the one screen. In a
multi-screen project you cannot: an object on screen 3 bound as though it were
on screen 1 is a binding the product resolves to nothing. That is why the `Wire`
type in `web/src/lib/ote/bindings.ts` carries an optional `screenId`, and why the
layout engine stamps every wire with the screen its part landed on.

## 3.10 The backslash quirk, and why it matters

This is the single most expensive detail in the format, and it has bitten this
project twice in two different languages.

**ZIP entry names inside an `.eote` use backslashes, not forward slashes.** The
entry is literally named `Screens\3f2504e0-...\Screen.dat`. The product writes
them that way, and it rejects an archive that uses forward slashes.

Two separate traps follow from that.

**Trap one: your ZIP library may rewrite them.** Python's `zipfile` silently
normalises backslashes to forward slashes. So a test that checks the library's
own list of entry names passes while the produced file is wrong. The fix is to
check the produced bytes:

```ts
export function assertBackslashEntries(bytes: Uint8Array): void {
  const text = Buffer.from(bytes).toString("latin1");
  if (!text.includes("Screens\\")) throw new Error("...no backslash-separated Screens entry");
  if (text.includes("Screens/")) throw new Error("...forward-slash entry names; OTE will reject it");
}
```

**Trap two: your programming language may eat the backslash.** In a TypeScript
or JavaScript string, `"Contents\Hierarchy.dat"` contains the escape sequence
`\H`. `\H` is not a defined escape, so the backslash is simply dropped and the
string becomes `ContentsHierarchy.dat`. No error, no warning. The entry is
written under a name the product does not know, and the project quietly lacks
something.

A forward slash would at least be visible in a listing. A vanished backslash is
not. So in `packager.ts` every nested entry name goes through a named constant
or a template that writes `\\` explicitly, and a separate assertion checks by
exact name that the expected entries are present:

```ts
const CONTENTS_HIERARCHY = "Contents\\Hierarchy.dat";
const SCREENS_HIERARCHY  = "Screens\\Hierarchy.dat";
const screenEntry = (id: string, file: string) => `Screens\\${id}\\${file}`;
```

## 3.11 The four properties that make full automation possible

Everything in this part adds up to four statements. If any one of them were
false, this product could not exist in this shape.

**1. Everything meaningful is plain JSON or plain SQLite.** A screen is a tree
of `Type` / `Children` / `Location` / `Width` / `Height`. A tag list is an
ordinary table. Both generate, diff and review like any other document.

**2. There is no signature and no encryption.** A file we write is as valid as a
file the product wrote. Nothing has to be defeated, and nothing is.

**3. Bindings are declarative.** The wiring is data: a text field, a target
property, and indices joining three arrays. It is not code, not a UI action
recording, not an opaque blob. The single most expensive manual task in the job
turns out to be the most mechanisable thing in the file.

**4. The geometry maps onto the browser.** Absolute `Location` plus `Width` and
`Height` inside a sized `ViewBox` is exactly how absolutely-positioned SVG
works. Colours are palette indices we can resolve.

Property 4 carries the entire user experience, and it is worth stating
separately: **the same JSON that becomes the project file drives the live
preview.** One model, two renderers. The preview cannot lie about the output,
because there is nothing else for it to draw.

---

# Part 4 · How our application is built

This part assumes you have never written a web application. If you have, skim to
4.9.

## 4.1 What a web application is

A web application has two halves.

- The **client** (also called the frontend) is what runs inside the browser on
  the user's machine. It draws the interface and responds to clicks.
- The **server** (also called the backend) is a program running elsewhere, or in
  our case usually on the same laptop, that the client asks for things over the
  network.

They talk over **HTTP**, the web's request/response protocol. The client sends a
request to a named path such as `/api/export`, and the server sends back a
response: some JSON, some HTML, or in our case sometimes an entire `.eote` file
as raw bytes.

We need both halves for a specific reason: **the packager cannot run in the
browser.** It has to read the skeleton files off a disk, and browsers cannot
read arbitrary disks. So the interface is the client, and packaging, tag
parsing, validation and the model calls happen on the server.

## 4.2 HTML, CSS, JavaScript, TypeScript

- **HTML** describes the structure of a page: this is a heading, this is a
  button, this is a list.
- **CSS** describes how it looks: this is 14 pixels, dark grey, with 8 pixels of
  padding. We use **Tailwind CSS**, which is CSS expressed as small composable
  class names (`flex items-center gap-2`) rather than as separate stylesheets.
- **JavaScript** is the programming language browsers run.
- **TypeScript** is JavaScript with type annotations added. You write
  `function lamp(name: string, box: Box): Part`, and a compiler (`tsc`) checks
  before the program ever runs that nobody passes a number where a string
  belongs.

TypeScript is not cosmetic in this project. It is the mechanism enforcing the
one rule (Part 4.11), and it is why adding a part type to the format layer
causes the canvas to stop compiling until it can draw it.

## 4.3 React, and what a component is

**React** is a library for building user interfaces out of **components**.

A component is a function that takes some data and returns a description of what
should appear on screen. Here is a real one, simplified from
`web/src/components/canvas/parts/index.tsx`:

```tsx
export function PartNode({ part, values, alarms }: PartNodeProps) {
  switch (part.Type) {
    case "Rectangle":      return <RectanglePart part={part} />;
    case "TextBox":        return <TextBoxPart part={part} />;
    case "Lamp":           return <LampPart part={part} on={Boolean(values?.[part.Name])} />;
    case "NumericDisplay": return <NumericDisplayPart part={part} value={...} />;
    case "AlarmSummary":   return <AlarmSummaryPart part={part} rows={alarms} />;
    case "Path":           return <PathPartNode part={part} />;
    default: {
      const exhaustive: never = part;   // <-- the one rule, enforced by the compiler
      void exhaustive;
      return null;
    }
  }
}
```

Read it as: *given one part out of a `Screen.dat`, return the drawing for it.*
The angle bracket syntax is **JSX**, which is JavaScript with markup written
inline; `<RectanglePart part={part} />` means "render the RectanglePart
component, handing it this part".

The important property of React is that **the interface is a function of the
data**. You do not write "when the user clicks, move the lamp fourteen pixels
left". You change the data, and React works out what on screen has to change.
That is exactly right for this product, because the data is the project file.

## 4.4 State, and what Zustand does

**State** is the data an application is currently holding: which project is
open, which objects are selected, what the screens contain, what the tags are.

Somewhere that has to live. Passing it down through every component by hand gets
unmanageable fast, so applications use a **store**: one place holding the state,
which any component can read from and write to.

We use **Zustand**, a small store library, together with **Immer**, which lets
you write updates as if you were modifying the data in place while actually
producing a new copy underneath. The copy is what makes undo cheap: keep the
previous version and you can go back to it.

`web/src/store/project.ts` (about 850 lines) is the store. It holds exactly what
the packager needs, plus the editing state the `.eote` has no room for:

```ts
screens        Screen[]      the object trees, exactly as the packager serialises them
variables      Variable[]    the tags
alarms         Alarm[]       the alarms
bindings       Binding[]     tag -> object property
objectMeta     locked / hidden / group id, kept BESIDE the parts, never inside them
selectedIds    what is selected on the canvas
versions       named snapshots for the History screen
chat           the conversation
```

That `objectMeta` decision is the one rule again. Locked, hidden and grouped are
editor conveniences; `Screen.dat` has no field for any of them. Keeping them
next to the parts rather than inside them means the packager keeps writing
exactly the JSON the product accepts, even though the editor gained a layers
panel.

**Persistence.** The store also writes itself to the browser's **localStorage**
(a small key-value store the browser keeps per site) on a debounce, so leaving
the workspace for the tag screen or pressing reload does not lose the work.
`web/src/store/persist.ts` does this, with a version number so a save from an
older shape is discarded rather than half-applied. This is real but it is
*local*: it survives a reload, and it does not survive clearing browser data or
moving to another machine. Part 7 says what that means.

## 4.5 Next.js, and what a route is

**Next.js** is a framework that packages React together with a server, so both
halves of the application live in one project, in one language, deployed as one
thing. We use its **App Router**, in which the folder structure *is* the URL
structure.

```
src/app/page.tsx                                  ->  /
src/app/(workspace)/project/[id]/page.tsx         ->  /project/demo
src/app/(workspace)/project/[id]/tags/page.tsx    ->  /project/demo/tags
src/app/api/export/route.ts                       ->  POST /api/export
```

A file named `page.tsx` is a page a person visits. A file named `route.ts` is an
**API route**: a function on the server that receives an HTTP request and
returns a response. There are eight of them:

| Route | Method | What it does |
|---|---|---|
| `/api/tags/parse` | POST | takes an uploaded file, returns typed tags plus the corrections it had to make |
| `/api/generate` | POST | runs the eight-step pipeline and **streams** the result |
| `/api/chat` | POST | one conversational turn: clarify, build, edit or answer |
| `/api/validate` | POST | runs the rules over a project, returns findings |
| `/api/export` | POST | packages a project into `.eote` bytes |
| `/api/export/report` | POST | renders the standalone HTML sign-off report |
| `/api/panel` | GET | which panel the extracted skeleton is actually for |
| `/api/symbols` | GET | the indexed graphic-object library |

Two of these declare `export const runtime = "nodejs"`. That is not decoration.
Next.js can run route handlers in a cut-down "Edge" environment that has no
filesystem, and both the packager (which reads the skeleton and a WebAssembly
file) and anything touching it need the full Node.js runtime.

## 4.6 SSE, and why streaming matters here

**SSE** stands for **Server-Sent Events**. Ordinarily an HTTP request gets one
response and the connection closes. With SSE the server holds the connection
open and pushes a sequence of messages down it, each one a line beginning
`data:` followed by a blank line.

```
data: {"type":"step","step":"ingest","state":"done","detail":"1248 tags"}

data: {"type":"log","at":"04:52:07","message":"Parsed 1248 tags"}

data: {"type":"object","part":{"Type":"Rectangle","Name":"Hdr_PumpStation1",...},"parentId":"..."}
```

Why it matters here is not technical, it is about trust. Generation takes
somewhere between about two seconds and about thirty, depending on the model and
whether the build is warm. The alternative to streaming is a spinner followed by
a finished screen appearing all at once, which is indistinguishable from a
mockup. With streaming, **the engineer watches the HMI assemble itself object by
object**, with a timeline beside it reading in engineering language:

> Parsed 1,248 tags → Detected 12 pumps, 21 instruments, 14 motors → Gemini read
> the request → Placed 434 objects across PlantOverview, PumpsUnit, ... →
> Configured 232 alarms → Bound 93 display properties and 232 alarm triggers →
> 0 errors, 0 warnings

Two design rules follow, and both are held in the code.

**One complete object at a time.** We never stream partially parsed JSON. A half
object cannot be rendered and cannot be validated. `runPipeline` is an
`AsyncGenerator` that yields whole events, and the route serialises each one.

**Never "Thinking...".** Every detail line is computed from what actually
happened. The event contract in `web/src/types/events.ts` is frozen, and the
comment above it says so: the timeline renders `step` and `log`, the canvas
appends on `object`, the binding map fills in on `binding`.

The parsing side has its own subtlety, which is why `web/src/components/
generation/sse.ts` exists on its own and is tested on its own: a frame can
straddle two network chunks, a chunk can contain several frames, and a
multi-byte character can be cut in half by the transport.

## 4.7 SVG, and why not a canvas element

Browsers offer two ways to draw pictures.

- **`<canvas>`** is a bitmap you paint pixels onto with code. Fast, and the
  result is just pixels: the browser does not know a lamp is there.
- **SVG** (Scalable Vector Graphics) is a description of shapes as elements in
  the page, like HTML. Each `<rect>`, `<text>` and `<path>` is a real node the
  browser knows about, can style, and can attach events to.

We render each screen as **inline SVG, one DOM node per object, each carrying
its `UniqueId`**. That choice pays for itself six times over:

| We get | Because |
|---|---|
| Click to select, hover to inspect | The clicked node carries the `UniqueId`, which resolves straight back to the JSON node. No hit testing of our own. |
| A 1:1 coordinate match with OTE | Absolute `Location` + `Width`/`Height` inside a sized `ViewBox` is exactly SVG's model. |
| Exact colours | Palette indices resolve to hex once, in one function. |
| Animation and diff highlighting | CSS transitions apply to SVG nodes. |
| Crispness at any zoom | Vectors, not pixels. |
| Documentation export | An SVG can be turned into a PNG trivially. |

`ScreenRenderer` owns the screen's own coordinate space and `CanvasPane` owns
the viewport (zoom, pan, fit, the armed tool). The split matters: the renderer
converts pointer positions through its own bounding box, so selection and
dragging stay correct at any zoom without either side knowing the other's
transform.

One more property, and it is a rule rather than a convenience. The editing
affordances layered on top, the marquee selection, the eight resize handles, the
smart guides, the grid, **none of them has a `UniqueId`**, so none of them can
reach the export. What you can drag is separate from what gets written.

## 4.8 zod, and what "schema-grounded generation" means

**zod** is a TypeScript library for describing the shape of data and checking
that real data matches. A zod schema is both a runtime validator and a
compile-time type.

`web/src/lib/ote/schema.ts` describes every part the packager can emit:

```ts
export const NumericDisplay = z.object({
  Type: z.literal("NumericDisplay"),
  UniqueId: z.string().uuid(),
  Name: z.string(),
  Location: Location,
  Width: z.number().nonnegative(),
  Height: z.number().nonnegative(),
  CurrentValue: z.number().default(0),
  DecimalDigits: z.number().int().min(0).max(6).optional(),
  TextColor: ColorRef.optional(),
  ...
});

export const Part = z.discriminatedUnion("Type", [
  Rectangle, TextBox, Lamp, NumericDisplay, AlarmSummary, PathPart,
]);
```

Every field in there was taken from a real object in
`reference/part_examples.json` or from a `.propDef` schema file in the
installation. None of it is invented. `Buildtime/PropertyDefinitions/` contains
machine-readable definitions for Screen, Variable, 25 parts and 13 layout
objects, and those are the source.

**Schema-grounded generation** means that when a language model is asked to
produce something, it is not asked for free text that we then hope to parse. It
is given a schema, and the provider's API constrains the output to match it.
A property that does not exist in the schema cannot come back. An enum value
outside the list cannot come back.

There is a second guard, because a schema cannot express everything. A schema
can say "`include` is an array of strings". It cannot say "every string must be
one of the 47 equipment ids inference just found". So `plan.ts` re-checks the
ids afterwards and drops any the model invented, with a comment saying exactly
why:

```ts
// No schema can express "must be one of these ids", so it is checked here
// rather than trusted. A hallucinated id would place an empty card.
const known = new Set(equipment.map((e) => e.id));
```

A practical wrinkle worth knowing, since it explains a chunk of code that
otherwise looks like duplication: **the two model providers take different
schema dialects.** Anthropic takes JSON Schema, where types are lowercase
strings and `additionalProperties: false` is meaningful. Google's Gemini takes
an OpenAPI subset, where types are an enum of uppercase names (`"OBJECT"`,
`"ARRAY"`) and `additionalProperties` is not part of the dialect at all. They
cannot be the same object, so `plan.ts` and `converse.ts` each carry both, built
from one shared table of field descriptions so the two cannot drift apart in
what they *mean*.

## 4.9 The repository, region by region

```
web/src/
  lib/ote/          THE FORMAT LAYER. Everything that knows what an .eote is.
    schema.ts         zod schemas: 6 parts, ViewBox, Screen, Variable, Alarm      200 lines
    parts.ts          factory functions producing real part shapes                190
    palette.ts        colour set 4, index -> hex                                   65
    layout.ts         lays out a whole APPLICATION: chrome, cards, tiles          392
    place.ts          where a new object goes when nobody said                    163
    bindings.ts       the Sources / Targets / Bindings graph builder              160
    databases.ts      writing Variables.db and Alarm.db with sql.js               185
    graphics.ts       .path Commands+Points -> SVG path                           145
    packager.ts       the whole thing -> .eote bytes                              316
    skeleton.ts       loads the skeleton extracted from a licensed install         63

  lib/ai/           INFERENCE AND PLANNING.
    infer.ts          tag names -> equipment. Deterministic, offline.             247
    plan.ts           the engineer's sentence -> a screen hierarchy               474
    converse.ts       one conversational turn: clarify / build / edit / answer    455
    ops.ts            the 14 operations a turn may perform                        158
    pipeline.ts       the eight steps, as a stream of events                      226
    name.ts           naming a project after what it turned out to be             133

  lib/tags/parse.ts   CSV / TXT / XLSX -> typed variables + corrections           175
  lib/validation/     naming.ts (178) rules.ts (297) report.ts (266)
  lib/sim/            engine.ts (243) alarms.ts (121). Pure client, no format knowledge.

  components/         49 files: canvas, inspector, binding map, chat, timeline, ...
  app/api/            8 route handlers
  app/(workspace)/    11 pages
  store/              project.ts (849), edits.ts, persist.ts, projects.ts, types.ts
  types/events.ts     the frozen SSE contract                                      82

tools/                the Python reference implementation, where every format
                      detail was established first against a real installation
reference/            part_examples.json, naming_rules.json
demo_project/         five generated .eote files, the proof
samples/              seven sample plants with tag exports and prompts
```

**121 TypeScript files, about 18,250 lines.** `npx vitest run` reports **450
tests**: 437 pass anywhere, and 13 skip on a machine without a licensed
EcoStruxure installation, because they need a skeleton extracted from one.

The Python reference in `tools/` is not legacy. Every format detail was
established there first, on the Windows machine that has the product, and
`web/tests/packager.test.ts` structurally diffs the TypeScript packager against
what the Python one produces: same entries, same binding graph, same rows. **Two
independent implementations agreeing is a much stronger claim than either one
passing its own tests.**

## 4.10 The eight pipeline steps

`web/src/lib/ai/pipeline.ts` is an async generator: it yields events as it goes,
and the route turns each into an SSE frame.

| # | Step | Goes in | Comes out | Where |
|---|---|---|---|---|
| 1 | **ingest** | the parsed tag list | `Variable[]`, or a hard stop if empty | `pipeline.ts` |
| 2 | **infer** | `Variable[]` | `InferredEquipment[]`: units, each with roles | `lib/ai/infer.ts` |
| 3 | **select** | equipment + the engineer's sentence | a `ScreenPlan`: how many screens, what is on each | `lib/ai/plan.ts` |
| 4 | **layout** | the plan + equipment + panel size | `Screen[]` and `Wire[]`, streamed object by object | `lib/ote/layout.ts` |
| 5 | **alarms** | equipment | `Alarm[]` | `infer.ts` `proposeAlarms` |
| 6 | **bindings** | the wires | one `binding` event each | `pipeline.ts` |
| 7 | **validate** | the whole assembled project | `Finding[]`, each carrying an `objectId` | `lib/validation/rules.ts` |
| 8 | **package** | the project | ready to export; bytes are written on demand by `/api/export` | `lib/ote/packager.ts` |

Three things are worth pulling out.

**Step 2 runs offline and is a parse, not a guess.** Tag names carry real
structure, so equipment falls out of splitting them. This is deliberate: if the
model is unreachable mid-demo, the screen still builds and the timeline says
`No model key set` rather than implying a model was involved.

**Step 3 is the only step a model does.** The model's job is the one thing
inference cannot do: read the engineer's sentence and decide what to show. It
does not write `Screen.dat`. It returns a plan: screen names, ISA-101 levels,
which equipment ids go on which screen, and which sections each needs. There is
exactly **one model call per generation** (roughly 650 input tokens for a small
tag list, about 14,000 for the 1,248-tag export).

**Step 8 does not actually write bytes.** By the time the pipeline finishes, the
project is complete in the store. Packaging happens when the engineer presses
export, because the skeleton lives on the server and the bytes are a download.

## 4.11 The one rule, and how the compiler enforces it

> **The canvas may only render what the packager can emit.**

The pitch is "one model, two renderers, so the preview cannot lie about the
output". The moment the canvas draws something no `.eote` can contain, the demo
becomes a mockup and a judge who opens the exported file finds out.

This is not maintained by discipline. It is maintained by `tsc`.

`Part` in `schema.ts` is a **discriminated union**: a value that is one of six
shapes, told apart by its `Type` field. TypeScript can prove a `switch` over it
is exhaustive. The `default` branch in `PartNode` assigns the remaining value to
a variable of type `never`:

```ts
default: {
  const exhaustive: never = part;
  void exhaustive;
  return null;
}
```

If every case is handled, the value reaching `default` has type `never` and the
assignment is legal. **Add a seventh part to `schema.ts` and that line stops
compiling**, because the leftover value is no longer `never`. The canvas cannot
be built again until it can draw the new part.

The reverse also holds. The interface cannot invent a visual, because there is
no schema case to render it from.

Two more places the same rule shows up, both worth noticing because they are
where the temptation is highest:

- **The Library panel.** A symbol whose index entry lacks `Commands`/`Points`
  cannot become a `Path` part the packager can emit, so it is shown greyed with
  the reason rather than placed.
- **The conversation.** The `type` field of an operation is
  `z.enum(PART_TYPES)`, the same list. A model cannot name a part type the
  packager cannot write, in either provider's schema, because both are built
  from that constant.

And the second half of the claim is held by a test. `web/tests/canvas.test.ts`
renders the fixture screen and checks the result against the rules
`tools/render_screen.py` used to draw `assets/screen_design.png`, **restated
independently rather than imported**, so the two renderers cannot drift together
and still pass.

---

# Part 5 · One sentence becoming a project

Now the whole thing end to end, with real data at every hop. The figures and
names below were produced by actually running the code, not written from memory.

**The input file** is a tag export with seven rows.

**The sentence** is:

> "Create a pump station screen with two pumps, flow and level, and a
> high-level alarm."

## Hop 1 · Tag parsing

`POST /api/tags/parse` receives the uploaded file. `web/src/lib/tags/parse.ts`
reads it with SheetJS (a library that handles CSV, TSV and XLSX alike), finds
the header row by **intent rather than position** (it accepts `Name`, `TagName`,
`Symbol`, `Variable`, `Tag` and more for the name column), maps whatever type
spellings the source used onto IEC types (`Analogue`, `float`, `flt` and
`Real` all become `REAL`), and normalises the names against OTE's own rules.

Out comes:

```json
[
  { "Name": "PMP_101_RUN", "DataType": "BOOL", "Comments": "Pump 101 running",   "DeviceAddress": "" },
  { "Name": "PMP_101_FLT", "DataType": "BOOL", "Comments": "Pump 101 fault",     "DeviceAddress": "" },
  { "Name": "PMP_102_RUN", "DataType": "BOOL", "Comments": "Pump 102 running",   "DeviceAddress": "" },
  { "Name": "PMP_102_FLT", "DataType": "BOOL", "Comments": "Pump 102 fault",     "DeviceAddress": "" },
  { "Name": "FT_101_PV",   "DataType": "REAL", "Comments": "Discharge flow LPM", "DeviceAddress": "" },
  { "Name": "LT_101_PV",   "DataType": "REAL", "Comments": "Tank level percent", "DeviceAddress": "" },
  { "Name": "LT_101_HI",   "DataType": "BOOL", "Comments": "Tank level high",    "DeviceAddress": "" }
]
```

plus, separately, a list of **corrections** and a list of **skipped rows with
reasons**. On the 1,248-tag water treatment export the parser reports **five
corrections**, because that file contains, on purpose, the sort of names a real
export contains and OTE will not accept: a name with a space, one with a hyphen,
one starting with a digit, one that is a reserved word.

> **This is the trust-relevant behaviour in the whole product.** OTE silently
> drops a name that violates its rules on import. We correct it and show the
> correction. `normaliseNames` in `web/src/lib/validation/naming.ts` returns
> `{ names, corrections }`, and the interface shows the second list. The rules
> themselves are not ours: they were extracted from
> `Help/en/featureguide/appendix/naming_conventions.htm` into
> `reference/naming_rules.json`, and include the IEC data types, the ASCII
> control codes (`ACK`, `BEL`, `CR`, ...) and the script keywords.

## Hop 2 · Equipment inference

`inferEquipment` splits each name into prefix, loop and role, then groups.
`PMP` is a known machine prefix, so `PMP_101_*` becomes a unit. `FT` and `LT`
are instrument prefixes, and both carry loop 101, so they **fold into pump 101**
because they measure what it does.

Real output:

```json
[
  { "id": "PMP_101", "kind": "pump", "label": "Pump 101", "symbol": "Pumps/Pump01", "loop": "101",
    "roles": [
      { "tag": "PMP_101_RUN", "role": "running", "dataType": "BOOL" },
      { "tag": "PMP_101_FLT", "role": "fault",   "dataType": "BOOL" },
      { "tag": "FT_101_PV",   "role": "flow",    "dataType": "REAL" },
      { "tag": "LT_101_PV",   "role": "level",   "dataType": "REAL" },
      { "tag": "LT_101_HI",   "role": "high",    "dataType": "BOOL" }
    ] },
  { "id": "PMP_102", "kind": "pump", "label": "Pump 102", "symbol": "Pumps/Pump01", "loop": "102",
    "roles": [
      { "tag": "PMP_102_RUN", "role": "running", "dataType": "BOOL" },
      { "tag": "PMP_102_FLT", "role": "fault",   "dataType": "BOOL" }
    ] }
]
```

Two details that show the difference between a parse and a guess.

**Role beats measurement.** `LT_101_HI` is a *high level switch*, not a level
reading. If the code let "L means level" overwrite the `_HI` suffix, the alarm
that tag should raise would be lost, and our own validator would then flag the
gap we had just created. So the measured quantity only names the role when the
suffix does not say something more specific.

**Symbols are honest.** The prefix table maps `CHL` to a chiller, but the
shipped symbol library has no chiller, so the code picks
`Air Conditioners/AirConditioner01` and says why in a comment. `BLR` maps to a
boiler, which the library also lacks, so it picks `General/Heater01`, because a
boiler is a fired heater and a tank symbol would look nothing like one. A screen
that calls a chiller an air compressor is wrong in a way an operator notices.

## Hop 3 · Alarm proposal

`proposeAlarms` walks the roles and applies encoded equipment knowledge:

| Rule | Produces |
|---|---|
| a BOOL with role `fault` | a bit alarm, severity 5, message from the tag comment |
| a BOOL with role `high` | a bit alarm, severity 3 |
| a numeric with role `level` | **two** level alarms: Hi at 85 (severity 3) and HiHi at 95 (severity 5) |

For our seven tags that is five alarms:

```
PMP_101_FLT  bit    sev 5   "Pump 101 fault"
LT_101_PV    level  Hi   85 "Pump 101 level high"
LT_101_PV    level  HiHi 95 "Pump 101 level critically high"
LT_101_HI    bit    sev 3   "Tank level high"
PMP_102_FLT  bit    sev 5   "Pump 102 fault"
```

That "warn, then act" pair on a tank level is not a model's idea. It is what a
tank always has, written into the code as a rule.

An honest wrinkle, visible right there: two alarms are labelled "Pump 101 level
high", because the level transmitter folded into pump 101's unit and the message
is built from the unit label. It is not wrong, and it is also not what an
engineer would have typed. That is the sort of thing the engineer corrects in
one turn of conversation, and it is a fair example of where inference stops
being enough.

## Hop 4 · Planning

Now the model. `planScreen` sends the equipment inventory and the engineer's
sentence, constrained to a schema that only allows equipment ids that already
exist and sections the packager can emit.

The system prompt encodes ISA-101 (the standard for HMI design), stated as
rules rather than as prose:

- Level 1 is a plant overview: every unit, status only, no readings.
- Level 2 is a unit overview: a faceplate per unit.
- Level 3 is unit detail.
- At most **6 units** on a level 2 or 3 screen, at most 12 on a level 1
  overview. Split rather than crowd.
- Produce a level 1 overview only when there are more than 4 units, or when the
  engineer asked for one. **One station with two pumps is one screen, not
  three.**

For two pumps and this sentence, the plan is one screen:

```json
{ "screens": [ { "screenName": "PumpStation1",
                 "title": "Pump Station 1",
                 "level": 2,
                 "include": ["PMP_101", "PMP_102"],
                 "sections": ["status", "process", "alarms"] } ],
  "rationale": "One unit overview: two pumps with their status, readings and the alarm banner." }
```

**With no model key configured, `fallbackPlan` produces the same shape**
deterministically, applying the same hierarchy rule, and the timeline says
`No model key set` rather than passing the fallback off as the model.

There is one more guard after the model answers, and it exists because of a real
observed failure. Asked for a whole plant, a model reliably plans the areas it
was told about and then stops: on a 94-unit plant it planned nine screens
covering 48 units, and the other 46 were inferred, named in the prompt, and then
simply absent from the project. No faceplate, no binding, no alarm.
`placeEveryUnit` keeps the model's grouping (it read the request and knows which
area is which) and finds a home for the leftovers, preferring a screen that
already holds the same kind of equipment.

## Hop 5 · Layout

`layoutApplication` in `web/src/lib/ote/layout.ts` turns the plan into actual
parts. The unit of work is the whole application, not one screen, because
ISA-101 is specific that navigation and the alarm banner must be in the same
place on every display.

Fixed zones, in screen units:

```
0                                                                        1024
+------------------------------------------------------------------------+  0
|  HEADER  green band, title left, "LEVEL 2 · UNIT OVERVIEW" right        |  44
+------------------------------------------------------------------------+
|  NAV     one chip per screen in the project, current one filled green   |  32
+------------------------------------------------------------------------+
|                                                                        |
|  CONTENT   level 1: 238x100 tiles, 4 across                            |
|            level 2/3: 320x162 faceplate cards, 3 across                |
|                                                                        |
+------------------------------------------------------------------------+
|  ALARM BANNER   "ACTIVE ALARMS" + the AlarmSummary part                 | 148
+------------------------------------------------------------------------+
|  FOOTER  screen name, unit count, "Generated by HMI Copilot"            |  28
+------------------------------------------------------------------------+  600
```

A **faceplate** (the industry word for a per-unit card) is built as: a rectangle
container, the unit name, the unit kind, a running lamp, a fault lamp, and up to
two numeric readings each with a label and an engineering unit. Two readings,
not six: a unit with more of them earns a detail screen, which is what the plan
is for.

The engineering unit is read out of the tag comment (`percent` or `%` gives
`%`, `lpm` gives `LPM`, `deg C` gives `degC`), falling back to the role.

Real output for our sentence: **one screen, 27 parts, 6 wires.**

```
Rectangle:Hdr_PumpStation1      TextBox:HdrTitle_PumpStation1   TextBox:HdrLevel_PumpStation1
Rectangle:Nav_PumpStation1      Rectangle:NavChip_PumpStation1_0 TextBox:NavLbl_PumpStation1_0
Rectangle:Foot_PumpStation1     TextBox:FootLbl_PumpStation1    TextBox:FootMark_PumpStation1
Rectangle:Card_PMP101           TextBox:CardName_PMP101         TextBox:CardKind_PMP101
Lamp:Lamp_PMP101_RUN            Lamp:Lamp_PMP101_FLT
TextBox:Lbl_FT101PV             NumericDisplay:Num_FT101PV      TextBox:Unit_FT101PV
TextBox:Lbl_LT101PV             NumericDisplay:Num_LT101PV      TextBox:Unit_LT101PV
Rectangle:Card_PMP102           TextBox:CardName_PMP102         TextBox:CardKind_PMP102
Lamp:Lamp_PMP102_RUN            Lamp:Lamp_PMP102_FLT
TextBox:AlarmsLbl_PumpStation1  AlarmSummary:AlarmBanner_PumpStation1
```

Every one of those is streamed to the browser as a separate `object` event, and
the canvas appends each as it arrives. That is what the engineer watches.

**Names are made unique across the whole application**, not per screen, because
the binding graph resolves a target by name and a duplicate would wire the wrong
object. That is what the `Placer` class exists for: one per application, its
name set carrying across every screen.

## Hop 6 · Binding resolution

The layout produced six wires as a side effect of placing things. It knows
`Lamp_PMP101_RUN` is a lamp for the running role of pump 101, so it knows what
drives it:

```
PMP_101_RUN  ->  Lamp_PMP101_RUN.CurrentValue
PMP_101_FLT  ->  Lamp_PMP101_FLT.CurrentValue
FT_101_PV    ->  Num_FT101PV.CurrentValue
LT_101_PV    ->  Num_LT101PV.CurrentValue
PMP_102_RUN  ->  Lamp_PMP102_RUN.CurrentValue
PMP_102_FLT  ->  Lamp_PMP102_FLT.CurrentValue
```

**This is the part that costs an engineer days, and it comes out as a side
effect of knowing what each part is for.** The bindings are not a separate
manual step because the layout never lost track of which tag it drew each object
from.

At package time, `buildGraph` turns those six wires plus the five alarms into
the `Sources` / `Targets` / `Bindings` arrays of Part 3.9. Total: **11 bindings**
(6 display, 5 alarm triggers) from 7 tags.

## Hop 7 · Validation

`validateProject` runs seven families of rule over the assembled project. Each
finding carries an `objectId` or a `tag`, which is what lets the binding map and
the validation list link to the same object and therefore never disagree.

| Rule | Catches | Severity |
|---|---|---|
| `naming` | illegal characters, leading digits, reserved words, duplicate tags, and the same on object names | error (info for script keywords) |
| `binding` | a part bound to a tag that is not declared; a value-displaying part bound to nothing | error / warning |
| `type-mismatch` | a REAL driving a Lamp, a BOOL driving a NumericDisplay | error |
| `alarm` | an alarm triggered by an undeclared tag; a bit alarm on a non-BOOL; a level alarm on a non-numeric; a level alarm with no numeric setpoint | error |
| `unused-tag` | a declared tag nothing on any screen uses | info |
| `completeness` | **a tag whose name looks like a fault tag but which raises no alarm**; a project with no screens | warning / error |
| `standards` | the project label disagreeing with `Target.dat`; a screen larger than the panel; a screen smaller than the panel; a part falling outside the screen area | error / warning |

The completeness rule is the one that encodes expert judgement rather than
mechanics: a fault tag with no alarm is the classic omission, precisely because
the lamp on screen looks like it is doing the job.

For this project: **0 errors, 0 warnings**, and one `info` per tag that nothing
displays.

## Hop 8 · Packaging

`POST /api/export` calls `packageProject`. In order:

1. Load the skeleton (entry name to bytes, plus a `LocalVariables.db`).
2. Take `Variables.db` out of it, `DELETE FROM Variables`, insert our seven rows,
   and keep the GUID assigned to each tag: the bindings need them.
3. Same for `Alarm.db`: one `AlarmGroup1` row, five `Alarm` rows, and keep what
   each alarm needs to be bound to its trigger.
4. For each screen, write `Screens\<guid>\Screen.dat`,
   `Screens\<guid>\Metadata.dat` and a copy of `LocalVariables.db`.
5. Write `Screens\Hierarchy.dat` listing the screens in order.
6. Build and write `Bindings.dat`.
7. Ensure `GlobalScripts.dat` and `Contents\Hierarchy.dat` exist. The blank
   template carries neither, but every shipped sample project does, so we write
   what a real project looks like rather than making the product repair ours.
8. Stamp `Project.dat` with new ids, the current time and `VersionModified`
   `4.4.0.0`.
9. Assert every expected entry is present by exact name, and that no entry
   contains a forward slash.
10. Zip with `createFolders: false`, so JSZip does not insert forward-slash
    directory entries of its own.
11. Assert against the produced **bytes** that `Screens\` appears and `Screens/`
    does not.

The response is the `.eote` as a download, with a header carrying the panel the
file is actually for.

If the skeleton is not present, the route answers **503** with the setup
instruction, and the export screen says so in those words. **That is a licensing
boundary, not a failure**: the skeleton is Schneider's files, extracted per
machine from a licensed installation, deliberately gitignored, and never
redistributed.

## What actually opens

`demo_project/HMICopilot_TS.eote` was written by the TypeScript packager and
**opens in EcoStruxure Operator Terminal Expert 4.4**. In the product's own tree:
Screens (1) shows `S00001 : PumpStation1 [View Box]`, All Variables shows 7, All
Alarms shows 5, and the screen renders with both pump lamps, both fault lamps,
both numeric displays and the product's own alarm summary grid. Nothing in that
file was written by Schneider's software.

## And at scale

The same path, run over the 1,248-tag water treatment export with the request
"build the whole plant, an overview plus a screen per area":

| | |
|---|---|
| tags parsed | 1,248 (5 names corrected, 0 rows skipped) |
| equipment inferred | 47 units: 12 pumps, 14 motors, 21 instrument groups |
| screens | 10 |
| objects placed | 486 |
| bindings | 325 (93 display properties, 232 alarm triggers) |
| alarms configured | 232 (192 bit, 40 level) |
| validation | 0 errors, 0 warnings |

One caveat, stated because it is true and because the figure will not reproduce
exactly: **the screen and object counts depend on how the model groups the
plant, and that varies between runs.** A re-run while writing this document
produced 8 screens and 434 objects from the same file and the same request. The
counts that do not vary are the ones that are computed rather than planned:
**325 bindings, 232 alarms, 0 errors, 0 warnings** came out identical on both
runs, because those follow from the tags rather than from the plan.

---

# Part 6 · What happens after generation

Generation is the beginning of the session, not the end of it. An engineer never
describes a screen correctly the first time.

## 6.1 The workspace

```
+---------------------------------------------------------------------------+
|  TopBar   project name · saved state · target panel · theme                |
+------+--------------------------------------------------------------------+
| Nav  |  CONVERSATION  |      CANVAS         |      INSPECTOR              |
| Rail |                |                     |                             |
|      |  what you ask, |  screen tabs        |  Properties (from schemas)  |
|      |  what changed, |  canvas / bindings  |  Layers                     |
|      |  questions as  |  / JSON tabs        |  Tags                       |
|      |  buttons       |  toolbar, zoom, fit |  Library                    |
|      |----------------+---------------------+-----------------------------|
|      |  BUILD TIMELINE   eight steps, and the run log beside them          |
+------+--------------------------------------------------------------------+
|  StatusBar                                                                 |
+---------------------------------------------------------------------------+
```

All three side regions collapse to a rail you can click to bring back, and below
1280 pixels wide they collapse on their own, inspector first, then the
conversation, because the canvas is the one that matters on a small screen.

## 6.2 The conversation, and the fourteen operations

`/api/chat` handles one turn. The model picks exactly one of four modes:

| Mode | Meaning |
|---|---|
| `clarify` | genuinely ambiguous; ask at most two specific questions, rendered as buttons |
| `build` | run the eight-step pipeline with this request |
| `edit` | a list of operations against the project as it stands |
| `answer` | a question about the project; change nothing |

The bar for `clarify` is deliberately high, and the prompt says why: an
assistant that interrogates an engineer before drawing a rectangle is worse than
one that draws the wrong rectangle, because the rectangle can be undone.

**The model never writes `Screen.dat`.** It picks from a list of fourteen
operations, and each one maps onto a store action that already existed for the
toolbar:

```
addScreen  renameScreen  deleteScreen
addObject  addEquipment  moveObject  resizeObject  duplicateObject  deleteObject
setText    setColor      alignObjects
bindTag    addAlarm
```

Three properties follow from that design.

**An edit asked for in words and an edit made with the mouse take the same code
path**, land in the same undo history, and are constrained by the same schema.

**Objects are addressed by name**, because that is what the model was given and
what the packager binds by. A name that does not resolve is reported, not
guessed at: "no object called Pump_3 on this screen" is a better outcome than an
edit to whatever was nearest.

**`addEquipment` places a whole faceplate in one operation.** This one is a
lesson learned rather than a design instinct. Given only rectangles and lamps, a
model asked to "show both boilers" builds each faceplate out of five primitives
and gets the arithmetic between them wrong: the container lands in one place,
the label in another, the lamps somewhere else again. So the chat reaches the
same `equipmentCard` function the generator uses instead of reinventing a layout
one rectangle at a time.

Colours are named (`green`, `amber`, `red`, ...) rather than hex, because a
model given `#2ecc71` would invent colours, and a colour that is not in the
palette cannot be written into a file OTE will open.

Placement has its own module, `lib/ote/place.ts`, because "add a high level
alarm lamp" is a complete request that says nothing about where. The old answer
was to default to 20,20, which meant three requests across three turns produced
three objects stacked in the corner. Now a position is computed from the actual
free space, and the scan is deliberately dumb (first free slot, reading order)
because a clever packer would move things the engineer did not ask about.

## 6.3 The inspector, generated from the schemas

The property editors are not written per part type. `schemaFields.ts` walks the
zod schemas at runtime and classifies whatever it finds, **structurally rather
than by name**: a field is a colour because its shape is `{ Color: { Value } }`,
which is how the product writes a palette reference, not because it happens to
be called `Fill`.

The consequence is the demo line: the inspector cannot offer a property
EcoStruxure does not have, and a property added to `schema.ts` appears here with
a working editor and no change to any component.

## 6.4 The binding map

Tags down the left, the object properties they drive down the right, connectors
between them. Green where a tag drives a display property, amber where a tag is
an alarm trigger. Filters for All / Bound / Unbound / Alarms.

Unbound rows come from the validation findings rather than from a second check
of its own, which is why the map and the validation list cannot disagree about
what is bound. Delete a binding and the same finding turns a row amber here and
appears there, both pointing at the same object.

This is the highest-value view in the product, because binding is the stated
pain point and today it is invisible until commissioning.

## 6.5 Simulation

`web/src/lib/sim/engine.ts` drives tag values on a tick so the screen behaves
before any hardware exists. It does not replay a recording; it builds a small
process model per tag out of what the project already declares:

- A numeric tag that triggers level alarms is driven **through** their setpoints,
  because an alarm nobody can make fire is an alarm nobody has tested. The
  highest setpoint sets the target.
- BOOL run tags in the same equipment family run lead/lag: one duty unit at a
  time, which is what a two-pump station actually does.
- One fault is injected on a standby unit, deliberately, so the alarm path and
  the red lamp state are both exercised rather than assumed.

Noise comes from a **seeded** pseudo-random generator, so the same project and
the same seed give the same run every time. That is what makes a demo safe to
rehearse.

The engine is pure client code and knows nothing about the file format. It
recovers each alarm's trigger the way the runtime does, by walking the binding
list, because `Alarm.db` has no trigger column. That keeps the evaluation
honest: unbind an alarm in the binding map and it stops firing here too, because
there is no longer a binding to find.

## 6.6 Export, and the sign-off report

The export screen offers three files:

| File | What it is |
|---|---|
| `<project>.eote` | the project, from `/api/export` |
| `<project>_report.html` | the validation sign-off report |
| `Variables.csv` | the tag list, which is useful even when the `.eote` is blocked |

The report is a **standalone HTML file**: no external stylesheet, no font host,
no script. That is deliberate and it is an operational fact, not an aesthetic
one. It has to open from a network share on a commissioning laptop that has no
internet.

---

# Part 7 · What is not built

Stated plainly, because a document that only lists what works is not useful.

**There is no `.eote` reader.** The product can create a project and cannot open
one. Most HMI work is brownfield: an engineer is far more often adding a pump to
a station built in 2019 than starting from nothing. This is the largest single
piece of remaining work, and it is harder than the writer, because it needs a
property the writer never needed: **round-trip safety**, meaning import a
project, change one screen, export it, and everything you did not understand
comes back byte-identical.

**Persistence is local only.** The store autosaves to browser localStorage with
a schema version, so a reload or navigating to the tag screen is survivable.
Clearing browser data, or moving to another machine, is not. There is no
server-side project storage. (An earlier draft of `docs/PRODUCTION.md` says
nothing survives a closed tab; that was true when it was written and is now out
of date.)

**Nothing talks to a PLC.** Generated variables are internal, which is what
makes the demo hardware-free. `DriverConfig.db` comes through from the skeleton
untouched. Until an engineer can point the generated tags at an actual device,
the export is a drawing rather than a finished project.

**Six part types, not fifty.** Enough for a pump station, an overview and an
alarm banner. No trend graphs, no bar graphs, no switches, no faceplate part.
Each additional one is a small piece of work with a captured example behind it;
none of them is done.

**Generation quality is unmeasured.** There is no eval harness: no corpus, no
scoring, no regression gate. The seven sample plants in `samples/` and the seven
one-click exports in `web/public/demo/` are the first stones of one, and
`tests/samples.test.ts` holds each to what it actually parses to, but nobody has
scored a generation against what an experienced engineer would have drawn.

**Alarm-management standards are not implemented.** The validation rules cover
naming, bindings, types, alarms, completeness and layout standards. They do not
cover **ISA-18.2 / IEC 62682**, the alarm management standard: priority
distribution, rationalisation, no alarm without a defined operator response, and
alarm-flood limits. On a 232-alarm generated project that gap is worth naming.

**The multi-screen situation, corrected.** `docs/PRODUCTION.md` §3.3 says the
canvas renders `screens[0]` and that real projects are 12 to 60 screens. The
first half is no longer true: `CanvasPane` resolves the active screen,
`ScreenTabs` adds, renames, duplicates, reorders and deletes screens, the
planner produces a hierarchy, and `layoutApplication` lays out a whole set with
shared navigation. A whole-plant run produces ten screens. The second half of
that section, that inferring a screen hierarchy from tag structure is the
interesting version of the problem, is exactly what shipped.

**Nobody has walked the demo script on the presenting machine.**
`web/tests/demo-path.test.ts` checks the data, the routes and the engine behind
every beat. It cannot check that a button is where the script says it is.

---

# Part 8 · Glossary

Every term, alphabetically, each with an example from this project.

**Air-gapped** · A network with no connection to the internet, on purpose. Plant
engineering frequently happens on them. It is why the sign-off report has no
external assets and why a local or self-hosted model is a requirement rather than
a nicety for real deployment.

**Alarm setpoint** · The threshold a level alarm compares a numeric tag against.
Our inference proposes a pair for any level reading: `Hi` at 85 and `HiHi` at 95.
Stored as the `Value` column of `Alarm.db`.

**API route** · In Next.js, a file named `route.ts` whose exported functions
handle HTTP requests on the server. This project has eight, including
`POST /api/export` which returns `.eote` bytes.

**Artifact boundary** · Integrating with a product by producing the files it
already reads, rather than by modifying it. HMI Copilot writes `.eote`; OTE opens
it. The boundary is language-agnostic, so our TypeScript and their C#/C++ never
have to meet.

**Binding** · A declared connection between a tag and a property of an object.
`{"BindingText": "FT_101_PV.Value", "TargetProperty": "CurrentValue"}` joined
through the `Sources` and `Targets` arrays of `Bindings.dat`. Making these by
hand is the most expensive part of the job this product automates.

**BOOL** · The IEC data type holding one bit, true or false. `PMP_101_RUN` is a
BOOL. A BOOL can drive a Lamp; a REAL cannot, and a validation rule enforces it.

**Brownfield / greenfield** · Brownfield means working on something that already
exists (adding a pump to a 2019 station); greenfield means starting from nothing.
This product currently only does greenfield, because there is no `.eote` reader.

**Buildtime** · The EcoStruxure engineering application that runs on an
engineer's Windows PC, where screens are drawn and tags declared. .NET/C# shell
with native Qt5/C++ modules. It produces a file and never touches the plant.

**Canvas element** · The browser's bitmap drawing surface, `<canvas>`. We
deliberately did **not** use it; see SVG.

**Commissioning** · Taking the project to site, downloading it to the physical
panel, connecting the real PLC, and finding out what is wrong. Every error this
product catches at design time is an error that would otherwise be found here.

**Component** · In React, a function that takes data and returns a description of
what to draw. `PartNode` takes one part out of a `Screen.dat` and returns its
SVG.

**Compound object** · A reusable group of OTE parts saved as a `.co` file and
dragged onto screens later. **Creating them is licence-gated**, which is one
reason this product places primitive parts directly on screens instead. The
compound-object packager in `tools/make_demo_co.py` still works as a secondary
output.

**Corrections** · The list of name changes the tag importer had to make, reported
rather than applied silently. On the 1,248-tag export there are five. OTE's own
behaviour is to drop such names quietly on import.

**`.eote`** · The EcoStruxure Operator Terminal Expert project file. A ZIP of
plain JSON and plain SQLite with backslash-separated entry names, no signature
and no encryption. One file is one whole HMI application.

**Equipment inference** · Reading tag names to work out what physical equipment
exists. `PMP_101_RUN`, `PMP_101_FLT` and `FT_101_PV` become one pump with a run
state, a fault and a flow reading, because they share loop 101.
`web/src/lib/ai/infer.ts`, offline and deterministic.

**Faceplate** · A per-unit card on an HMI screen: the unit's name, its running
and fault state, and its readings, laid out consistently. Ours is 320 by 162
screen units, built by `equipmentCard` in `layout.ts`, and reachable both by the
generator and by one `addEquipment` operation from the conversation.

**GUID** · Globally Unique Identifier, a 128-bit random id such as
`3f2504e0-4f89-11d3-9a0c-0305e82c3301`. Every screen, part, tag and alarm has
one. `Variables.db` stores them uppercase.

**HMI** · Human Machine Interface. The screen an operator looks at to see what
the plant is doing. Physically usually a touchscreen panel bolted into a control
cabinet.

**IEC 61131-3** · The international standard defining PLC programming languages
and the data types (`BOOL`, `INT`, `REAL`, ...) this product supports.

**ISA-5.1** · The instrumentation naming standard that gives tag names their
structure: first letter says what is measured (`F` flow, `L` level, `P`
pressure, `T` temperature). It is why `FT_101_PV` is parseable rather than
arbitrary.

**ISA-101** · The standard for HMI design: a display hierarchy (plant overview
above unit overviews above detail), navigation and alarm banner in the same
place on every screen, colour as a signal rather than decoration. Encoded in our
planner's prompt as rules and in the layout engine as fixed zones.

**ISA-18.2 / IEC 62682** · The alarm management standard: priority distribution,
rationalisation, no alarm without a defined operator response, alarm-flood
limits. **Not implemented here.** Named because a 232-alarm generated project is
exactly what it exists to govern.

**JSON** · JavaScript Object Notation, the plain-text structured data format.
`Screen.dat`, `Project.dat`, `Target.dat` and `Bindings.dat` are all JSON.

**Level alarm** · An alarm that fires when a numeric tag crosses a threshold.
`AlarmRecordType` 2 in `Alarm.db`. Contrast with a bit alarm
(`AlarmRecordType` 1), which fires when a BOOL goes true.

**Next.js** · The React framework this application is built with. Client and
server in one project, one language, one deploy. The folder structure is the URL
structure.

**Palette index** · A colour on an OTE screen is not RGB, it is a number from 1
to 60 indexing the project's colour set. `{"Fill": {"Color": {"Value": 3}}}` is
index 3, which in colour set 4 "Green-Simple" resolves to `#00b050`. This is why
our theme toggle cannot theme the HMI screen.

**Panel** · The physical touchscreen device on the plant floor. Default target
here: `HMIST6500AWADI` at 1024 by 600. Read out of `Target.dat`, never typed.

**Part** · OTE's word for a drawable object type on a screen. Fifty exist; this
product emits six: Rectangle, TextBox, Lamp, NumericDisplay, AlarmSummary, Path.

**PLC** · Programmable Logic Controller. The industrial computer wired to the
equipment, running the control program. It has no screen; the HMI is what a
human looks at.

**Round-trip safety** · The property a reader would need and the writer never
did: import a project, change one screen, export it, and everything you did not
understand comes back byte-identical. Get this wrong once, in a way that
silently discards a recipe table, and nobody gives the product a second project.

**SCADA** · Supervisory Control And Data Acquisition. The larger, PC-based
cousin of a panel HMI, supervising many PLCs across a site. Shares the
vocabulary; not this product's target.

**Schema-grounded generation** · Constraining a model's output to a machine-
readable schema so invented properties cannot survive parsing. Here the schemas
come from the product's own `PropertyDefinitions/` and from real objects in
shipped samples, so what the model can produce is bounded by what the product
defines. Plus a second pass for what schemas cannot express, such as "this
equipment id must be one that inference actually found".

**Skeleton** · The set of files extracted from a licensed OTE installation that
every generated project starts from: `Recipe.db`, `Security.db`, `Language.db`,
`DriverConfig.db` and the rest, copied through verbatim. Gitignored, extracted
per machine by `npm run setup:skeleton`, never redistributed. Its absence is why
`/api/export` can answer 503.

**SQLite** · A complete relational database in a single file, no server.
`Variables.db` and `Alarm.db` are SQLite. We read and write them with sql.js,
which is SQLite compiled to WebAssembly.

**SSE** · Server-Sent Events. An HTTP response the server holds open, pushing
messages down it one at a time. How `/api/generate` streams the pipeline so the
engineer watches the screen assemble object by object instead of watching a
spinner.

**State** · The data an application currently holds. Here: the screens, tags,
alarms, bindings, selection and history. Kept in a Zustand store.

**SVG** · Scalable Vector Graphics. Shapes as real elements in the page rather
than painted pixels. Chosen over `<canvas>` because each object becomes a node
carrying its `UniqueId`, which maps click-to-select and hover-to-inspect
straight back to the JSON.

**Symbol** · One of the 475 graphic objects shipped in the product's
`GraphicObjects/` folder, stored as `Commands` plus `Points`. Our indexer
converts 474 of them into SVG paths while keeping the originals, so a placed
symbol is a real `Path` part the packager can write.

**Tag** · A named value in the PLC: name, data type, address, usually a comment.
`PMP_101_RUN`, `BOOL`, `%MX10.0`, "Pump 101 running". The unit of everything.

**Target.dat** · The JSON entry naming the panel model and resolution a project
is for. The authority on both, over anything our application believes.

**Tier 0 to 3** · The integration ladder. Tier 0 is the artifact boundary (this
project). Tier 1 is Lua scripting, which both Buildtime and RunTime embed. Tier
2 is a native or managed plugin, needing Schneider's SDK and code signing. Tier
3 is UI automation, which is brittle and not worth it.

**RunTime** · The program that executes on the physical panel: reads the project,
talks to the PLC, draws the screens, raises the alarms. C++/Qt5 with embedded
Lua. The thing the operator stares at during an emergency.

**ViewBox** · The drawable area of a screen, sized to the panel, holding every
object as its `Children`. The root of the object tree inside `Screen.dat`.

**WebAssembly** · A portable binary instruction format that runs inside
JavaScript environments. sql.js is SQLite compiled to it, which is why our
packager has no native dependency and runs anywhere Node.js runs.

**Wire** · Our internal name for one binding before it is serialised: a part, a
tag, a property, and the screen the part is on. `Wire[]` comes out of the layout
engine and goes into `buildGraph`.

**zod** · The TypeScript schema library. `web/src/lib/ote/schema.ts` uses it to
define what a screen object may contain, which is simultaneously the compiler's
type, the runtime validator, the model's constraint and the inspector's field
list.

**Zustand** · The state management library holding the project in the browser.
Paired with Immer so updates read as mutations while producing new copies, which
is what makes undo and version snapshots cheap.

**ZIP** · The container format. Many files packed into one, each called an entry.
An `.eote` is a ZIP whose nested entry names use backslashes, which is the single
most expensive detail in this format.
