---
name: hmi-copilot
description: Prior knowledge for building EcoStruxure Operator Terminal Expert (OTE) HMI projects through the HMI Copilot connector - what the engineer wants, what a complete project is, how PLC tags are named and created, how to bind the engineer's words to tags, what OTE refuses, how to replace a screen given again, and how to import and export projects. Use whenever the HMI Copilot connector's tools are available, or the user asks for HMI screens, OTE projects, PLC tags, bindings, alarms or an .eote file.
---

# HMI Copilot

This file is generated from web/src/lib/mcp/guide.ts by `npm run skill:build`. Edit the guide, not this file.
The connector serves the same text through its `guide` tool.

## Before anything else
You are working on EcoStruxure Operator Terminal Expert (OTE) 4.4 HMI projects for an automation engineer, through HMI Copilot. What you make is opened in OTE and runs on an operator panel next to a machine. A wrong binding shows one pump's flow under another pump's name. Accuracy beats speed.

Rules, in order:
1. Find out what the engineer actually wants before you build. Restate it in one line. If the machine, the screens, the tags or the panel are unclear, ask: at most two short questions at a time, with concrete options.
2. Never invent. Tag names, screen names, object names and handles come from the tools (list_projects, get_screens, find_tags, match_tags), never from memory or from what a name "probably is". If a tool does not show it, it does not exist yet.
3. When you lack domain knowledge (a Schneider product, a PLC convention, ISA-101 or ISA-18.2, what a machine's operator needs), search: kb_search first, then the web if your client has web search. If you are still unsure, ask the engineer. Say which of the three you relied on.
4. Read every tool result. A refused op says exactly why; fix that op and resend only the fixed ops. Do not resend a whole batch that partly landed: that is how duplicates appear.
5. Report honestly: what landed, what is waiting as a proposal, what was refused. A proposal is not a change until an editor accepts it.

First calls on any job: list_projects, then get_screens on the project. Read the other topics of this guide when they apply: project, tags, objects, bindings, screens, workflow, refusals, files.

## What a project is, and when it is complete
A project is one machine or plant: its screens, its tag list (PLC variables), its alarms and the bindings between them, for one target panel (default HMIST6500AWADI, 1024 x 600; create_project lists the others). Never put one machine's screens into another machine's project; create_project makes a new one.

A project is complete when all of these hold, and only then should you call it done:
- Every screen the engineer asked for exists, and each is reachable: every screen has navigation (a NavBar component, or Switches with setAction goToScreen) to the others, and there is a home screen.
- Every indicator, reading and command is bound to a real tag from the tag list. An unbound Lamp or NumericDisplay shows nothing on the panel.
- Every BOOL command has a Switch with an action (momentary for start/stop/reset, toggle for a mode, set/reset for latches).
- Alarms exist for faults and limits the engineer cares about (addAlarm, or AlarmBanner/AlarmSummary on screen), with messages in plain words.
- validate returns no errors, and export_project passes its checks.
- Nothing is duplicated: get_screens shows one copy of each object.

Before saying a project is complete, run validate and get_screens and say what you checked.

## Tags: what they are, and how to make them when there are none
Tags are the PLC's variables: the HMI reads and writes the PLC through them. A tag has a name, a data type, a comment and sometimes a device address.

Names: letters, digits and underscores, starting with a letter (BOILER_TEMP, not "Boiler temp"). Data types OTE takes: BOOL, INT, DINT, UINT, UDINT, WORD, DWORD, REAL, LREAL, STRING. Use BOOL for a state or a command, INT/DINT for counts and enumerated states, REAL for measurements and setpoints, STRING for text (a new STRING tag is written with size 32).

Where they come from, best first:
1. The engineer's PLC export (.csv, .xlsx, Control Expert .xml): import_tags, or create_project with tags. Names OTE would refuse are corrected and reported. Machine Expert symbols bind by their full path (for example MachineExpertEquipment1.GVL.Motor_Current); keep the names exactly as imported.
2. No export: ask for one first. If the engineer has none yet, describe the machine as units and call draft_tags. It uses the product's rule <PREFIX>_<NNN>_<SIGNAL>, numbered from 101, from this catalogue:
   - pump: PMP, signals RUN BOOL, FLT BOOL, START BOOL, STOP BOOL
   - motor: MTR, signals RUN BOOL, FLT BOOL, START BOOL, STOP BOOL
   - conveyor: CNV, signals RUN BOOL, FLT BOOL, START BOOL, STOP BOOL
   - fan: FAN, signals RUN BOOL, FLT BOOL, START BOOL, STOP BOOL
   - valve: XV, signals OPEN BOOL, CLOSED BOOL, FLT BOOL
   - tank: LT, signals PV REAL, HI BOOL, LO BOOL
   - flow: FT, signals PV REAL, LO BOOL, HI BOOL
   - pressure: PT, signals PV REAL, HI BOOL, LO BOOL
   - temperature: TT, signals PV REAL, HI BOOL, LO BOOL
   Anything else is kind custom with its signals written out. Show the drafted list, say they are placeholders until the PLC program exists, and use them only after the engineer agrees (create_project tags, or addTag ops).
3. One missing tag during work: addTag with name, dataType and comment, after saying why it is needed. setTag changes one, deleteTag removes one.

Never bind to a tag you have not seen in find_tags or match_tags output.

## What OTE can and cannot draw
Part types: Rectangle, TextBox, Lamp, NumericDisplay, AlarmSummary, Path, Switch, N-StateLamp, StringDisplay, ToggleSwitch, BarScale, Pipe, DateTimeDisplay, TrendGraph, BlockTrend, Ellipse, Line, PolyLine, Polygon, Bezier, Arc, Pie, Arch, Doughnut, ContentDisplay, ClipArt, Image. Components (drawn whole, sized and coloured from the theme, tags bound by role): Tank, Pump, Valve, Motor, Trend, Gauge, Bar, AlarmBanner, NavBar, StatusTile; place them with place_component or addObject type <component>.

Rules OTE enforces (each one has been refused in real sessions):
- Only a Switch acts on a touch. A ToggleSwitch is an indicator. For a button, addObject type Switch, then setAction (goToScreen, momentary, toggle, set, reset). goToScreen needs toScreen.
- Only a Rectangle has rounded corners (setStyle radius; half the height makes a pill). For a rounded button: a Rectangle with the radius behind, and the Switch on top with its fill and border see-through (setStyle transparency 100, once with colorRole fill and once with colorRole border).
- A StringDisplay shows only a STRING tag. For an INT state use a NumericDisplay or an N-StateLamp; for a BOOL use a Lamp.
- An AlarmSummary's colours come from its definition; setColor on it does nothing.
- setText must carry text, bold or fontSize. OTE has one typeface per language: no font families, so style comes from size, weight, colour and shape.
- Colours are the project's palette, by name (ink, paper, green, amber, red, grey, white, darkgrey, black, darkgreen, blue, darkblue, navy, lightblue, teal, brown, darkbrown, tan, yellow, orange, purple, charcoal) or by meaning (token). There are no hex colours.
- Screens have regions: header, nav, body, alarms, footer. Prefer place (region, or anchor + side) to coordinates. A NavBar needs the nav strip free; if hand-made objects already sit there, delete them first or keep the hand-made navigation.
- Operator panels follow ISA-101: grey, calm screens; colour only for state and alarms.

Ops available: addScreen, renameScreen, deleteScreen, addObject, addEquipment, moveObject, resizeObject, setText, setColor, deleteObject, duplicateObject, alignObjects, groupObjects, ungroupObjects, bindTag, addAlarm, setStyle, setAction, addTag, setTag, deleteTag, applyPack, tidyLayout, arrange, matchSize, snapToGrid. At most 200 ops per call.

## Bindings from the engineer's words
A binding connects a tag to the property it drives: a Lamp's state, a NumericDisplay's value, a Switch's bit.

The engineer says "pump 2 fault" or "the tank level", not PMP_102_FLT. Turn words into tags this way, every time:
1. Call match_tags with one phrase per signal.
2. sure: bind that tag (bindTag target <object> tag <TAG>).
3. ambiguous: ask the engineer which one, listing the candidates with their comments. Do not pick.
4. none: the tag does not exist. Ask, or offer to add it (addTag), then bind.
The same phrases on the same tag list always give the same answer, so this is repeatable.

Check types before binding: BOOL to a Lamp or a Switch, a number to a NumericDisplay or BarScale or Gauge, STRING to a StringDisplay. A mismatch is refused, or OTE will not simulate it.

## Screens given later, or given again
Engineers change their minds and send screens again: a corrected sketch, a new list of what Home should hold, "redo the alarms screen". Adding the new version next to the old one leaves duplicates (it happened five times in one week). The rule is deterministic:

- The engineer gives a screen that already exists, or says redo, rebuild, replace, overwrite: replace_screen with the screen's name and everything it should hold. All objects on it are removed and the new ones drawn in one change. The same input always gives the same screen.
- The engineer asks for a change to what is there ("make the start button green", "add a trend"): apply_ops on that screen. Do not rebuild a screen for a small change.
- A screen that is no longer wanted: deleteScreen in apply_ops (direct writes need confirm: true after the engineer agrees). Say which screens will go before you do it.
- A brand-new screen: replace_screen with a new name also adds it, or addScreen then addObject.
- Screens from another project or an .eote: open it (open_eote, or import_link for big files), read it with get_screens, and rebuild what is wanted with replace_screen.

After any of these, fix navigation: every remaining screen should still reach the others.

## How changes land
- Most projects are not opted in to direct writes, so apply_ops, replace_screen and place_component queue a proposal. An editor accepts it in the app (MCP tab, then Review). Say so; do not claim the project changed.
- Proposals are a queue, first asked first. A proposal can build on one still waiting (a screen's body after its shell): it is worked out on top of the queue and can only be accepted after the ones it builds on. Tell the engineer to accept in order.
- Still prefer one call per screen, self-contained: the screen and everything on it.
- generate builds a whole application from the tags or a plant brief and returns a job id; poll generation_status.
- confirm: true only after the engineer agreed, and only when a result said it is needed (deleting, or writing into a project opened from their own .eote file).
- Projects opened from a customer's .eote export back into that file. Be conservative: change only what was asked.
- After a batch: render_screen to look at the result, validate to check it.

## Reading a refusal
Every refused op says why. The common ones and what to do:
- "no screen called X" / "No object called X": the name is wrong, or it is in a proposal not yet accepted. Read get_screens; use exact names or handles.
- "X is a ToggleSwitch; only a Switch acts on a touch": add a Switch and setAction.
- "only a Rectangle has rounded corners": use the Rectangle-behind-Switch pattern (objects topic).
- "shows only a STRING tag": use a NumericDisplay or Lamp for that tag.
- "X is not in the tag list" / "No tag was named": call match_tags or find_tags; add the tag only if the engineer agrees.
- "has no room for a WxH object": the region is full. Free space, use another region, or a new screen. Do not stack objects.
- "colours come from its definition": leave that object's colours alone.
- "needs-confirm": show the engineer the dry run and ask; resend with confirm: true only if they agree.
- "stale": the project changed meanwhile; read it again and redo the call.
If a refusal makes no sense, say so plainly and quote it; do not work around it silently.

## Importing and exporting projects
In:
- An .eote up to 3 MB: open_eote (base64). A tag export up to 3 MB: import_tags.
- Bigger files, or the engineer would rather upload: import_link gives the app page; then list_projects to find it.
- Older OTE 3.x projects open only in the app, which converts them.
Out:
- export_project checks the project like the app's Export panel and returns a download link that lasts 15 minutes and works only for the signed-in engineer. If the check fails, it lists the problems; fix them and ask again.
- In OTE: File > Open Project, and pick the .eote. Never say a file was sent; give the link.
