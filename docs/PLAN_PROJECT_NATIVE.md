# Plan: project-native, not a re-made EcoStruxure

Written 2026-10-30, after the HMI Panel-1 rig (samples/hmi-panel-1/README.md).
Branch `feat/project-native`, off `main`. Each claim is marked **measured** (a
script or test on real files says so) or **to verify**.

## 1. The problem

Every new project broke something, and each fix was found by trial and error.
Three causes, all in the code:

1. **The model lost what it did not know.** zod strips unknown keys, and the
   writer merged a part over its raw self at the top level only. So any field the
   product writes and we did not model was dropped when a part was edited,
   copied, or moved to another project. On the real corpus (the rig, OTE's six
   Start Page templates, four imported projects) that came to **more than 7,500
   fields**. Among them: every Switch's `ClickTrigger.Destination` (the bit a
   button writes) on any edit, a display's `Suffix` (its unit), `IntegerDigits`,
   face images, fonts' Bold. **Measured** (scripts/project-check.mts).
2. **Our parts are ours, not the project's.** The app draws every button and
   display from its own factories (lib/ote/parts.ts). It ignores the objects
   already in the project, so the output never looks like the engineer's.
   Whether an older editor (the lab's 4.1) accepts our shapes is also a guess.
   One factory was wrong outright: it wrote `DecimalDigits`, which the product
   does not have (its NumericDisplay.propDef says `FloatDigits`, default 0).
   So every reading on a panel showed whole numbers. **Measured.**
3. **The Copilot is blind to the project.** It gets tag names and a plan
   format. It does not see what the project's screens hold, how the engineer
   draws a push button, or how they bind it.

The terminal session succeeds where the app does not because it reads the file
in front of it and copies what the engineer did. The app has to do the same.

## 2. The rule

**The project is the source of truth. Copy what the engineer did; invent only
when the project has no example.** Everything we do not model travels with the
object, untouched.

## 3. Phases

### Phase 1: lossless. Done on this branch.

- `lib/ote/schema.ts`: `Part` parses losslessly at every depth (`lossless()`).
  It is typed as the strict schema, so no other code changes. `Location` stays
  strict, because a part in the store sits on a canvas.
- `lib/ote/containers.ts` `flatten`: a part's grid pinning (Margin,
  ObjectAlignment) is resolved into its box, so it does not ride along onto a
  canvas.
- `lib/ote/fidelity.ts`: writes a project back two ways (every object edited in
  place, and every screen moved to a new project) and counts every field lost,
  by type and path.
  - `scripts/project-check.mts <file|folder>` prints that count.
  - `tests/fidelity.test.ts` holds every project under `samples/`, plus the
    OTE templates where OTE is installed, to zero.
- Result: from more than 7,500 lost fields to **0**. **Measured.**
- `FloatDigits` replaces `DecimalDigits`. `IntegerDigits` and `Suffix` are
  modelled.
- Screen tree (`packager.ts` `rehang`, `reader.ts` depth-first order):
  - A new screen joins the branch that holds most of the project's screens. On
    the rig that is MasterScreen, so it is shown inside the engineer's header
    (Home, Alarm and Settings icons, title, clock). It used to go to the top
    level, outside the frame.
  - A deleted screen now leaves the branch it was on. Before, it stayed listed
    under the master.
- Real projects are not in git: the repository is public, and every project
  carries its PLC connection (`DriverConfig.db`). They live in `samples/`
  locally and are gitignored. Their tests skip when the files are absent.

### Phase 2: project-native objects (exemplars). Done on this branch.

`lib/ote/exemplars.ts`:

- `harvest(project)` walks every screen and content screen of the opened file,
  modelled or carried, Compound Object instances included, together with
  `Bindings.dat`.
- Each object bound to a tag gets a kind from the role of that tag
  (lib/ai/infer.ts `roleFor`): push button (a command or reset written), mode
  toggle, setpoint entry, reading, gauge or bar, status text. Unbound text
  becomes a label.
- An exemplar is the raw object plus how it is bound: TargetProperty, Mode and
  binding Type, as the engineer bound it.
- On the rig:

  | Kind | The engineer's object | Bound as |
  |---|---|---|
  | Push button | `CompoundObject.Switch_PB04` (OperationType 3) | `CV`, Mode 2 |
  | Setpoint | `CompoundObject.Display_ND01` | `Value.CV` |
  | Readings | `Gauge_10` and `BarGraph_Vert_30` | — |
  | Numbers | NumericDisplay, Font 23 to 24 Bold, with a Suffix | — |
  | Labels | TextBox, Font 24 | — |
  | Mode | ToggleSwitch MANUAL / AUTO | — |

`nativise(input, exemplars)`:

- Every part we generated (one the file did not have) whose kind the project
  has an example of is written as a clone of that example.
- Taken from the example: its raw object, its exposed properties, its style.
- Kept from ours: our UniqueId, Name, box, the label text (a CO's text strings,
  a face's Text), the unit (Suffix) and the digits.
- The wire is rewritten to the example's binding property and mode.
- A part with no example stays ours.

Where it runs:

- On export of an opened project, as "use the project's own objects", on by
  default.
- In `scripts/into-project.mts`.
- The canvas keeps drawing our part. The export report lists what was written
  as which of the project's objects, so nothing is hidden.

Tests:

- On the rig's tags, the Drive screen's START, STOP and RESET come out as
  `Switch_PB04` instances bound to `CV` (Mode 2), with the engineer's colours
  and font.
- The setpoint comes out as `Display_ND01` on `Value.CV`.
- A project with no examples is unchanged.
- The fidelity check stays at zero.

### Phase 3: the Copilot sees the project. Done, except the new ops.

- A read tool, `project_style` (lib/ai/tools.ts), returns the exemplars by
  kind: type, size, colours and font, how each is bound, and the screen frame
  (master screen, header, background). The planner and the chat therefore say
  "a button like your START" instead of guessing.
- The single-machine rule (inferEquipment `oneMachine`) is enforced on the LLM
  plan as well as the fallback. A plan that splits one machine over several
  screens is merged back (`plan.ts` `oneFaceplate`, tests/drive.test.ts).
- The chat request carries the opened project's `sourceId`. The chat route
  reads that project and hands `describeOwn(harvest(...))` to the tools. If
  the read fails, the chat goes on without it.
- New ops (`cloneObject` from an exemplar or an object by name, `useStyleOf`)
  wait for `feat/architecture` to merge. That branch moves the op union to
  `core/ops/` (section 4), and adding ops before then is a guaranteed conflict.

### Phase 4: the gates, so a new project fails loudly. Import check done.

- Import runs the in-place half of the fidelity check (`fidelity.ts`
  `editLoss`). It reuses the read the import already did, and costs about a
  second on Demo 1 (105 screens, 3.7 MB; both halves take 2.6 s). A non-zero
  count is added to the import's warnings with the five worst type.field
  paths, instead of breaking silently later. The check never blocks an
  import. **Measured.**
- Every real project dropped into `samples/` is in `tests/fidelity.test.ts`
  from then on.
- The OTE bench (UI automation against the licensed editor) opens each
  generated file and validates it. This needs the editor closed on the laptop,
  so it is Shaurya's run:
  1. Close OTE.
  2. Run `scripts/into-project.mts` (samples/hmi-panel-1/README.md) to write
     the file.
  3. Run the bench script on it (memory: OTE bench on licensed editor).
  4. Open the file in 4.4, then in the lab's 4.1. **To verify** on the lab's 4.1: whether it opens
  cloned CO instances. They are the editor's own shapes, so it should.

## 4. Working beside the team

Antik's branch `feat/architecture` is at `598d7ae`, round 1 of
docs/PROMPT_FOR_ANTIK.md:

- `core/ops` and the store sliced by domain.
- Supabase Realtime behind a flag.

Round 2 (S1 to S7: sign-in without OAuth, plant brief, MCP connector) has not
been pushed. Its S1 item 6 (the committed `.DS_Store` files) is still open on
the branch.

To stay out of each other's way:

- This plan's work stays in `lib/ote/`, `lib/ai/infer.ts`, `lib/ai/plan.ts`,
  `lib/ai/tools.ts` (read tools only), `scripts/` and `tests/`.
- It does not touch `store/`, `core/ops/`, `lib/ai/ops.ts`,
  `lib/ai/applier.ts`, `lib/realtime/`, `lib/collab/` or auth.
- Small, additive edits to `app/api/chat/route.ts` (the project's own
  objects), `app/api/import/route.ts` (the warning), `lib/ai/converse.ts` and
  `components/chat/useChat.ts` (one field each). If round 2 rewrites these
  for the MCP connector or generate jobs, carry the few lines over.
- Overlap risk: the S3 plant brief may touch `lib/ai/plan.ts` or
  `lib/ai/pipeline.ts`. Merge `feat/architecture` first, then this branch, and
  resolve there.
- The `FloatDigits` rename touches `components/inspector/` and
  `components/canvas/parts/BasicParts.tsx`. These are small and mechanical, and
  not on Antik's file list.
