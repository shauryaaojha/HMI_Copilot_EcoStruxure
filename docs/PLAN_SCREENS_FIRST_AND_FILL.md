# Plan: screens first, tags later; and imported Fill colours

Source: Krishnadas K's review of the demo (mail, 2026-10-21). Two points:

1. The workflow is tag-first. Screens are generated only after tags are imported. Engineers also design screens first and bind tags later; that path is missing.
2. Objects imported from an existing EOTE project show Fill as "Unset" with a transparent colour.

Code checked on 2026-10-22 (`main` at 91503bb).

## What the code does today

| Point | Where | Behaviour |
|---|---|---|
| Tags required to generate | `web/src/lib/ai/pipeline.ts:103` | `variables.length === 0` fails with "no tags supplied" |
| Regenerate blocked | `web/src/app/api/regenerate/route.ts:29` | `code: "no-tags"`, "Import the tag export first" |
| Bindings built from tags | `web/src/lib/ote/bindings.ts` `buildGraph` | throws `binding references "<tag>", which is not in the variable list` |
| Plant Model | `web/src/lib/plant/model.ts` | derived from the tag list; no tags, no equipment |
| Hand-drawn screens | canvas Insert menu | works; objects have no binding |
| Tag bind per object | inspector `setBinding` store action | one tag at a time, by hand |
| Import screens from another .eote | `store/project.ts` `importScreens`, `ImportScreensDialog.tsx` | works; imported objects carry their own Fill |
| Export of an opened file | `packager.ts` `packagePreserved` / `mergeScreen` | untouched parts are written from the raw bytes; edited parts from the parsed copy |
| Export of a new project | `packager.ts` `packageProject` (fresh build) | every part is written from the parsed copy only |
| Fill readers | `components/canvas/parts/geometry.ts` `fill()` | handles `{Type: 0}`, gradients, solid colours and packed colours |

Not checked yet: which part schemas in `schema.ts` declare `Fill`. The fresh build writes only what the schema keeps, so a missing key is one suspect below.

## Part A: imported Fill shows "Unset"

**Status (2026-10-22): fixed, uncommitted.** `web/scripts/fill-audit.mts` reproduced it: on the import path (fresh write), 68 Fill values were lost across Schneider's Demo 1, Demo 2 and the Sample projects. The opened-file path was already correct. Causes found:

- `TextBox` and `AlarmSummary` had no `Fill` in their schema, so zod stripped it on the fresh write. Fixed by modelling `Fill` on both (`schema.ts`).
- `Paint` tried `ColorRef` first. A typed paint that also had a `Color` (`{Type: 5, Color, Color1, Color2, Speed}`) matched it and lost `Type`, `Color1`, `Color2` and `Speed`. Fixed by ordering a typed branch first, with its `Color` still validated.
- The inspector found the solid-colour option by position, which the reorder broke. It now finds it by shape (`schemaFields.ts`).

After the fix the audit reports 0 changes on all 20 projects, both paths. Regression tests: `web/tests/fill.test.ts`. Full suite: 1158 pass. Not yet checked: the output opened in licensed OTE. The bench only proves a project opens and simulates, not the colour shown, so that step is still a manual look.

"Unset" is OTE's own label. This codebase never writes that word, so OTE reads the written Fill as having no colour. The canvas draws the colour correctly, which means the loss happens on write, not on read.

### A1. Reproduce (first, no code change)

1. Use the three sources Krishnadas could have used: a project from Schneider's Buildtime templates (`Buildtime/BuildtimeData/ProjectTemplates/*.eote`), `demo_project/`, and a sample from `samples/`.
2. For each source, run the two write paths:
   - Open the .eote, export with no edits (`packagePreserved`).
   - Import screens from it into a new project and export (`packageProject`).
3. Diff the `Fill` key of every part in source and output. `scripts/roundtrip.mts` already compares entries; extend it to report Fill specifically.
4. Bench the output in licensed OTE 4.4 with `web/scripts/ote-bench.ps1` and read the Fill property of the same object. Record the result per path.

Done when we can say which path loses the colour and which part types it affects.

### A2. Hypotheses, in order of likelihood

- **H1, schema strips Fill.** A part type whose zod schema does not declare `Fill` loses the key in the fresh build. Check the Part schemas in `schema.ts`; any part with a `Fill` in its OTE output but not in its schema is a suspect.
- **H2, Transparency-only colour.** `ColorRef.Color.Value` is optional (`schema.ts`, ColorRef). A colour written as `{Color: {Transparency: n}}` with no `Value` is accepted, and the write may emit it without a colour index. OTE would then show no colour. The product writes this shape for default colours, so the reader must keep it and the writer must not drop it.
- **H3, packed colour in a palette project.** `ColorIndexEnabled: false` values are packed RGB. If a project's own colour set is used on write, the packed value becomes an index and resolves to the wrong colour or none. Less likely, because the transparency is the symptom.
- **H4, 3.x conversion.** `struct.ts` converts the old layout and does not mention Fill. Relevant only if the source is a 3.x project.

Confirm or rule out each one with a test fixture, not by reading alone.

### A3. Fix

- Make both write paths write Fill exactly as read. Add `Fill` (and `Border`) to every part schema that OTE writes it on.
- Keep Transparency-only and typed paints as they are read. Never write a Fill the parser did not read.
- Add a fixture set to `tests/` with one object per Fill form: solid index, packed colour, Transparency-only, `{Type: 0}`, gradient. Round-trip each through both paths and assert the Fill is identical.
- Re-run A1's bench. Done when every fixture object shows its colour in OTE, not "Unset".

Size: small to medium, depending on which hypothesis holds.

## Part B: screens first, tags later

### Target behaviour

An engineer can:

1. Create a project and design screens with no tags. Objects can be placed, named and given a role or intent ("tank level", "pump run").
2. Import the tag export at any time.
3. Get a binding proposal for every unbound object. Accept, edit or leave each one.
4. Export a project whose bindings are partly done. Unbound objects are valid, not errors.

### B1. Project state allows unbound objects

- Validation (`web/src/lib/validation/semantic.ts`) must treat "no binding yet" as a status, not an error, when the project has no tags or the object has no intent.
- `buildGraph` must skip objects without a binding instead of expecting one. Keep the throw for a binding that names a missing tag.
- Store: add `bindIntent` (optional role or tag hint) on each object. It stays in the project store; it is not written into the .eote, so OTE output is unchanged.

Tests: a screen with three unbound bars exports with zero Bindings rows and no throw.

### B2. Generate screens without tags

Two options. Recommendation: **option 1**.

1. **Pending tags.** The pipeline accepts an intent with no tags and creates screens whose objects carry `bindIntent` and a pending name (for example `TNK_1_LEVEL`). Pending names are kept out of Variables.db until bound. Reuses the existing pipeline and compiler.
2. Ask the user for a list of tag names up front. Rejected: it recreates the tag-first order.

`/api/regenerate` and `pipeline.ts` change from "fail with no tags" to "generate pending". The error stays only for a request that asks for a bind with nothing to bind to.

### B3. Binder on tag import

When tags are imported into a project that already has screens:

1. Match each unbound object to tags, in this order:
   - explicit `bindIntent` naming a tag;
   - object name tokens against tag name tokens (`Ind_TNK_Bar` against `TNK_101_LEVEL`);
   - Plant Model role: the object's equipment class against the tag's class and role (`lib/plant/model.ts`).
2. Each match has a confidence. High confidence is proposed; low is listed and left unbound.
3. Show the proposals in the existing corrections-style panel (the one `useTagImport.ts` uses for name changes). Nothing is applied silently.
4. Accept writes `setBinding` for each object. Reject leaves it unbound.

Tests: fixture with 12 tags and 6 unbound objects. Expect the 4 clear matches proposed, the 2 ambiguous ones unbound, and no throw.

### B4. Chat and inspector

- Chat: "bind the tank bar to TNK_101_LEVEL" becomes a binding op, one object at a time, using the same applier path as other ops.
- Inspector: a bound or unbound state per object, with the same tag picker as today.

### B5. Export order

Variables.db rows must exist before the Bindings rows that name them. `packager.ts` already writes variables first; add a test that exports a screens-first project and checks the order and the row count.

### B6. Verify

Build a screens-first project in the app, import the tags, accept the binder's proposals, export, and simulate in licensed OTE with the bench. Done when the project simulates and the bound objects show live values.

## Order of work

1. **A1, reproduce Fill.** Needed before any fix.
2. **A3, Fill fix and fixtures.** Small and visible; Krishnadas is waiting on it.
3. **B1, unbound state.** Foundation for B2 to B4.
4. **B3, binder.** The main user-facing piece.
5. **B2, pending generation.** Makes "screens first" real end to end.
6. **B4, chat and inspector.** Polish.
7. **B5 and B6, export order and OTE verification.**

## Decisions needed

1. Pending names (B2 option 1) or require a tag list first? Recommendation: pending names.
2. Binder auto-applies high-confidence matches, or always asks? Recommendation: always asks in this first version.
3. Should `bindIntent` survive a round trip through the .eote? Recommendation: no. Keep it in the app store; OTE does not need it.

## Out of scope

- The Plant Model's own tag-class work (`lib/plant`), beyond using its roles for matching.
- Reading `.xvm` exports.
- Any change to the Schneider-owned files (`web/skeleton/`, `graphics-index.json`); they are never committed.
