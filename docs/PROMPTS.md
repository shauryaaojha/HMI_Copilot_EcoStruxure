# Prompts

The prompt that goes with each sample tag export lives with the sample, in
`SAMPLES` in `web/src/components/tags/useTagImport.ts`, and the Copilot offers
it once that sample is the import. `web/public/demo/README.md` records what each
one actually produced. This file is the rest: what to type when you want to show
the product refusing, asking, or being edited by hand.

The Copilot picks one of four things each turn:

| Mode | When | What you see |
|---|---|---|
| **build** | a whole screen or set of screens from the tag list | the eight steps run, the canvas fills object by object |
| **edit** | a change to what is already there | the changes listed under the reply, and a *revert to here* link |
| **clarify** | the request names something that does not exist, or could mean two things | one or two questions, as buttons |
| **answer** | a question about the project | a reply, nothing changes |

The bar for **clarify** is deliberately high. It will not stop to confirm what
it can reasonably assume — it assumes, acts, and says what it assumed, because
undo is one keystroke and an interrogation is not.

---

## Prompts that should make it ask

```
Fix the pump screen.
```
> Which screen, and what is wrong with it — with the screen names as buttons.

```
Move the reading up a bit.
```
> Which reading? There are four numeric displays on this screen.

```
Add the alarm.
```
> Which tag should trigger it, and at what setpoint?

```
Delete the screens I do not need.
```
> This one it should refuse to guess at entirely.

And the counter-examples — these should **not** produce a question, because a
reasonable assumption exists and the reply states it:

```
Make the fault lamps stand out more.
```
```
Tidy up the process panel.
```

---

## Prompts that show it being honest

A demo that only shows the happy path is not a demo of a tool anyone would
trust. These are the ones worth having in the back pocket.

**On a brand-new project, before importing anything:**

```
Create a pump station screen.
```
> There are no PLC tags in this project yet, and equipment is inferred from tag
> names — so there is nothing to lay out. It says so once, in the reply, with a
> link to import. It does not invent a pump.

**Naming something that does not exist:**

```
Move Pump_999 to the top left.
```
> *No object called Pump_999* — reported, not applied to whatever was nearest.

**Binding a tag that was never imported:**

```
Bind FT_999_PV to the flow display.
```
> *FT_999_PV is not in the tag list, so nothing was bound.*

**Asking for something the format has no room for:**

```
Add a trend chart of the last hour of flow.
```
> There is no trend part in `Screen.dat`, so it will not draw one. The rule the
> whole product rests on is that the canvas may only render what the packager
> can emit — an object on screen that no export could contain is the one failure
> this is built to make impossible.

**And the import, on `Legacy_Retrofit.csv`:** four rows typed `Analogue`,
`boolean16`, `flt` and `??` are skipped **with a reason**, not defaulted to
something plausible. Defaulting `Analogue` to `REAL` would be a reasonable guess
that silently puts the wrong type in front of an operator.

---

## Editing by hand, not by prompt

Everything the Copilot does through its op list, you can do directly — the same
store actions, the same undo history.

| | |
|---|---|
| `R` `T` `L` `N` `A` | rectangle, text, lamp, numeric display, alarm summary |
| `V` / `H` | select / pan |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo, 60 steps |
| `Ctrl+D` · `Ctrl+C` `Ctrl+V` `Ctrl+X` | duplicate · copy, paste, cut |
| `Ctrl+G` / `Ctrl+Shift+G` | group / ungroup |
| `[` / `]` | send to back / bring to front |
| arrows / `Shift`+arrows | nudge one unit / nudge by the grid |
| `Ctrl+A` | select everything visible on this screen |
| `Ctrl+1` / `Ctrl+0` | fit / actual size |

Drag an object near another one's edge or centre and it snaps, showing the guide
line that caught it. The **Layers** tab is the paint order, not a view of it —
dragging a row there changes what the export contains.

---

## Where the equipment names come from

Every prompt above works because `lib/ai/infer.ts` reads tag names rather than
guessing. It knows these prefixes as machines:

```
PMP PUMP P    pump        MTR MOT      motor       FAN    fan
VLV VAL       valve       TNK TK       tank        CMP    compressor
BLR BOILER    boiler      HTR          heater      FIL FLTR  filter
CNV CONV      conveyor    RCT REA      reactor     DOS    doser
```

and these instrument first-letters, ISA-5.1: `F` flow, `L` level, `P` pressure,
`T` temperature, `A` analysis, `S` speed. A tag is split into prefix, loop
number and role suffix — `_RUN`, `_FLT`, `_PV`, `_SP`, `_HI`, `_LO` — and
instruments fold into whatever machine shares their loop number.

A prompt that names equipment the tag list does not contain gets a screen bound
to nothing, and the engineer blames the model rather than the sentence. That is
why `tests/samples.test.ts` checks each sample's own prompt against its own
tags.
