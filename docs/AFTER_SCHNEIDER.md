# After Schneider's answers

*What we built since the questions went to Krishnadas, what his answers change,
what is left, and the phases that follow. 22 September 2026.*

`ENGAGEMENT_PLAN.md` is what we wanted to settle before building more.
`REENGINEERING.md` is the architecture. `ARCHITECTURE_SCREEN_QUALITY.md` is how
screens get good. This is the ledger between them: the answers came back, and
this is where they land.

---

## 1 · What came back, in one line each

| # | We asked | Schneider answered | What it means for the build |
|---|---|---|---|
| 1 | Which panels, and is OTE or Vijeo the tool for them? | Both tools support many target types. **The solution should not be specific to any panel.** | The panel is a descriptor at the end of the pipeline, never a branch inside it |
| 2 | Is there a project API, a redistributable skeleton, an OEM route? | No API, and none planned. The format is open — JSON, XML, SQLite. **The ideal POC is a web-based HMI designer that imports a project, modifies it and exports it back**, for EOTE, Vijeo, or both | The product shape is confirmed, exactly as we built it. The licensed-install dependency stays ours to solve |
| 3 | Is HMI on the Industrial Copilot roadmap, and where would an agent live? | There is ongoing work on a **Copilot Live Agent embedded in EOTE and Vijeo Designer**. Our POC aligns and *"can be integrated with minimal effort"* | Our operation layer is the integration surface. It has to be a contract, not an implementation detail |
| 4 | Is there a headless build or CLI to verify generated projects? | No. Their framework does the first verification by hand, then **saves the generated runtime output and compares the next one against it**. *"You can apply the same logic as well."* | A method, handed over. Golden corpus plus comparison is now a specified requirement, not our idea |
| 5 | Which equipment library is canonical? | **None.** EOTE has Compound Objects and predefined libraries, and customers build their own | Composites must be library-agnostic, and must emit as real `.co` compound objects |
| 6 | Do you want a Vijeo → OTE migration assistant? | **No.** But the solution should be **easy to adapt to Vijeo Designer** | Migration is cut. The writer becomes an interface with two implementations |

Four of the six changed the design. Two confirmed it.

---

## 2 · What we have built since the mail

Nineteen commits, 127 files, **+16,235 / −2,468 lines**, in three phases. Every
item below is on `main` and covered by tests.

### Phase 1 · Read before write (`260a842` … `81bd57c`)

The prototype could only write. An engineer with an existing application got
nothing from it. That is now closed.

- **A reader with a byte-identical round trip** (`ff5c65a`). Open a `.eote`,
  write it back, and the bytes match — entry order, backslash entry names, JSON
  key order, both SQLite databases. This is the single test that makes
  "import, modify, export" safe to say out loud.
- **The conversation edits a model, not a canvas** (`efcdebb`). The model emits
  17 typed operations — `addScreen`, `addObject`, `addEquipment`, `moveObject`,
  `bindTag`, `addAlarm`, `applyPack` and the rest — validated by schema and run
  through the same store actions as the toolbar, so a change asked for in words
  lands in the same undo history as one made with the mouse.
- **Proposals are ghosts before they are edits** (`f2dbf8b`). The canvas draws
  what the model wants to do, and nothing changes until the engineer accepts.
  Lookup tools let it ask for what the prompt does not hold rather than invent.
- **Nine more part types** (`dc4245b`, `7269cfd`), taking the palette from six to
  **fifteen**: Switch, N-State Lamp, String Display, Toggle Switch, Bar Scale,
  Pipe, Date/Time, Trend Graph, Block Trend. Configuration we do not model
  survives the round trip untouched.
- **The editor caught up with the generator** (`7b06ec1`): binding from the
  inspector with the tag list filtered to what the part accepts, every element
  of a list property editable, a status bar that says which model is running.
- **Sessions recorded as replayable transcripts** (`11b7659`, `81bd57c`). The
  first recording immediately exposed two real faults in the applier; both
  fixed, both now tests that run without a key.

### Phase 2 · A project is more than its screens (`8be95ca` … `c21a96d`)

- **Carried objects are visible** (`8be95ca`). An object type we do not model is
  read, summarised, drawn hatched on the canvas and written back unchanged.
  Opening a project can no longer lose anything, and the engineer can see what
  we are not touching.
- **Screens imported from another `.eote`, with their bindings re-pointed**
  (`c21a96d`), and every correction reported rather than applied silently.
- **`xlsx` removed** (`11b7659`) in favour of `exceljs` plus our own
  delimiter-sniffing reader, for a dependency with a live advisory. Every
  sample still parses to the same counts.

### Phase 3 · Screens at the level of the real ones (`914ffca` … `aa3083a`)

First the architecture (`914ffca`): decompose "professional screen" into eight
measurable properties, then put agents only where judgement is and nowhere near
geometry. Then five of its seven items:

- **The Standard pack** (`ba04eb0`). What good looks like, as data: tokens and
  rules, ISA-101 defaults on the product's own colour set. The generator reads
  the tokens; the lint reads the same rules; `applyPack` brings a screen drawn
  without the standard onto it with a per-object diff. Grey ground, colour for
  abnormal only, a font floor by viewing distance, a density ceiling.
- **Composites** (`308e421`). An analogue indicator is one object with
  properties — tag, range, normal band, unit — not six rectangles. Instance
  records live in the store, the inspector edits the properties as one form, and
  a range change re-expands the object in place as a single undo step.
  AnalogIndicator, KpiTile, EquipmentSymbol so far.
- **The Plant Model** (`6af7b6a`). Site → Area → Unit → Equipment with classes,
  roles, a range per reading (read from the tag comment when the export states
  one, class default marked as an assumption when it does not), and connections
  with confidence. It asks **at most one question** per plant. All eight sample
  plants model cleanly, acyclic, every reading ranged. The tree is editable in
  the app.
- **The Screen Program and the process view** (`bff16f3`). A screen is described
  in words with no coordinates, then compiled: the plant graph laid out left to
  right by flow, a symbol per machine with its running and fault indicators,
  pipes as elbows between them, a reading beside each one. When it runs out of
  room it drops callouts, then shrinks symbols, never the panel edge — and says
  which in the build log.
- **The pipeline sees its own screens** (`aa3083a`). Any screen renders to a PNG
  through the canvas's own SVG; the critic looks at that picture against the
  pack's checklist and returns a scored report naming real objects. A finding
  about an object the screen does not have is dropped.

**The critic earned its place on the first afternoon.** Three runs on the
generated transfer pump station found four real defects in our own output —
symbols invisible on the grey ground, pumps labelled "level", indicator labels
overlapping their values, two measurement suffixes unrecognised. All four fixed.
The fourth run scores **4 / 5**.

### Where that leaves the numbers

Measured at `f5004c6` (the commit the mail was written against) and at `aa3083a`.

| | Then | Now |
|---|---|---|
| Test files / cases | 23 / 336 | **41 / 482** |
| Part types | 6 | **15** |
| Can open an existing project | no | **yes, byte-identical** |
| The standard | a hard-coded palette | **data, enforced by a lint** |
| Screen quality | an opinion | **a score from a critic that reads the render** |
| Plant structure | tags in a flat list | **a model with classes, ranges and flow** |

---

## 3 · Scored against what Schneider actually asked for

| His directive | Where we stand |
|---|---|
| **Not panel-specific** | Partly. The layout resolves against a target descriptor, but resolutions and the colour set are chosen in one place rather than loaded as a profile. Phase 6 |
| **Web-based designer: import → modify → export** | **Done, and tested.** Byte-identical round trip, screen import with re-pointed bindings, corrections reported, unmodelled objects preserved |
| **Aligns with the embedded Live Agent** | **Structurally, yes.** 17 typed operations, validated, undoable, identical to the mouse path. Not yet published as a contract another host could call. Phase 7 |
| **Compare saved runtime output between releases** | **Not started.** Phase 4, next |
| **Library-agnostic, Compound Objects** | Halfway. Composites are parametric and take whichever library is present; they do not yet emit as `.co`. Phase 5 |
| **Adaptable to Vijeo** | Not started. The writer is still OTE-shaped rather than an interface. Phase 6 |

---

## 4 · What is left

### Open inside what is already built

- **The frame is off the 8px grid.** Header 44, nav 32, margin 12; every
  generated screen reports it as information. Moving them touches the slot
  resolver's tests and the packager reference, so it is its own change.
- **An indicator has no live bar.** The product's bar-graph part is not yet
  captured from the installation, so an indicator is scale, band and number.
- **Composite records do not survive a round trip.** They are ours, not the
  file's; an opened project's indicators come back as grouped parts. The `.co`
  work in Phase 5 is what fixes this properly.
- **Critic findings are a panel, not ghosts.** They should appear on the canvas
  with accept and discard, like the conversation's proposals, and the second
  pass after accepted changes should be automatic.
- **The agents are deterministic.** The modeller, the architect and the composer
  are naming conventions and rules today. That is the right default — it works
  with no key — but a model pass should read comments and DDTs for what names do
  not carry, and choose between screen variants.
- **Programs are not kept.** Only what they compiled to is stored.
- **Persistence is still `localStorage`.** No project lifecycle, no audit trail
  that survives a cleared browser.

### Blocked on Schneider

These are not engineering problems. They are asks.

1. **How the runtime output is produced** from a project, and which files
   constitute it. Phase 4 cannot be verified against the real artefact without
   it.
2. **Three to five representative projects**, ideally with their runtime output,
   covering more than one target type.
3. **A sample Compound Object** from a predefined library, and any description of
   the `.co` structure.
4. **A Vijeo Designer project and variable export**, in whatever form is
   shareable.
5. **The licensed-install question.** Every project we write embeds the skeleton
   and graphic library from an OTE installation. Our proposed answer: the user
   points the app at their own installation once, locally, and nothing
   Schneider-owned leaves their machine or enters our repository. That needs a
   yes.

None of the four phases below is blocked on these. Each is verified better with
them.

---

## 5 · The phases that follow

Re-ordered so that the two things Schneider named explicitly come first.

### Phase 4 · Conformance as a number *(his answer 4)*

His method, adopted directly. A golden corpus of projects in the repository; a
runner that builds each one on every release; the output compared against the
stored copy; the release fails on a difference nobody intended. Comparison on the
project files today, on the runtime output as soon as we know how to produce it.
Alongside it, the quality numbers we already have: lint violations per screen,
critic score per screen, operations accepted versus proposed, build time.

**Done when** a release prints those numbers and a diff, and a change that
silently alters an untouched screen cannot merge.

### Phase 5 · Native objects *(his answer 5)*

Composites emitted as real EOTE **Compound Objects**, so what the tool generates
is something a customer can open, edit and keep in their own library rather than
a group of rectangles that happens to look right. With it: the frame as a master
screen, and ingest of a customer's own library so their symbols are what we
place. The `.co` format is already understood — nested ZIPs of plain JSON.

**Done when** a generated faceplate opens in OTE as a compound object, and a
customer's own library symbol comes out the other side of a build.

### Phase 6 · Format independence *(his answers 1 and 6)*

The panel becomes a loaded profile, not a constant. The writer becomes an
interface — read, write, declare capabilities — with OTE as the first
implementation and Vijeo Designer as the second. The inference, the Plant Model,
the Screen Program, the standard pack and the critic sit above it and do not
change. Migration stays cut, as he asked.

**Done when** the same tag export produces a project for two target types and
two formats, and adding a third touches only the adapter.

### Phase 7 · The agent seam *(his answer 3)*

The operation set published as a contract: a schema, a validator and a small
host interface, so a Live Agent embedded in EOTE could drive the same model with
the same guarantees — validated, undoable, standards-checked. Then the agent
passes that are still deterministic: the modeller reading comments and DDTs, the
architect choosing what belongs on which screen, the critic's findings as ghosts
on the canvas with a second pass after acceptance.

**Done when** the operation contract is documented well enough for someone else
to call it, and a build can be driven from outside our own UI.

### Standing, across all four

Persistence with versions and a sign-off record; the provider seam pointed at an
on-premise endpoint; packaging for a machine with the network cable out. None of
it blocks the phases above, and all of it blocks a customer.
