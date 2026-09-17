# Phase 2: the project is more than its screens

*Written 17 September 2026, after Phase 1 and the part-coverage track.
`REENGINEERING.md` §6 names the phases; this is the concrete order for the
next one, with the acceptance test for each item, in the form `PLAN_PHASE1.md`
used.*

Phase 1 made an existing project openable and returned it byte-identical.
What it did not do is let the engineer *see* everything in it, bring screens
in from elsewhere, or prove the conversation on real model output. Phase 2 is
those three, plus the one dependency the audit flagged.

| # | Item | Why now | Done when |
|---|---|---|---|
| 1 | **Carried objects visible** | An opened screen with a `Grid` or a `ClipArt` on it shows a hole where the object is; the engineer places a lamp on top of something they cannot see | `tests/foreign.test.ts`: reading a file with an unmodelled part lists it per screen with its type, name and box; the canvas draws it hatched with its type name; the layers panel lists it as carried; it cannot be selected, moved or deleted; export still puts it back at its index |
| 2 | **Import screens from another `.eote`** | "Screen lifted from one project into another with its bindings re-pointed" is the Phase B demo, and the reader makes it a store action away | `tests/import-screens.test.ts`: screens from a second file land with fresh ids and unique names; tags they bind that the project lacks are added; bindings are re-pointed by tag name; bindings to tags the file did not carry are dropped and reported; the strip has the door |
| 3 | **Recorded sessions** | Phase 1 item 6. The three transcripts are hand-written; a change in a prompt is unmeasured until a real model answers | `scripts/record-session.mts`: runs a scripted list of requests through the live provider, the dry run and the commit, and writes a transcript `tests/transcripts/` replays without a key; one recorded against Gemini in the tree |
| 4 | **`xlsx` out** | Two high-severity advisories with no fix on npm, in one file | `exceljs` reads spreadsheets, a delimiter-sniffing reader handles `.csv` and `.txt`; every row of `tests/samples.test.ts` still parses to the same count; `npm audit --omit=dev` is clean |

Items 1 and 2 are this pass. 3 needs one afternoon with a key and is built so
that afternoon is short. 4 is small and last because it touches nothing else.

### What comes after (Phase 3, not started)

- **Browser tests.** Playwright over the canvas, the Insert menu and the
  inspector, with screenshots for the Schneider conversation. Every UI check
  today is a server render of the SVG.
- **Master screens, header and footer, navigation types**, from
  `Screens\Hierarchy.dat` and the product's own help. The reader lists the
  hierarchy; it does not yet model it.
- **Image and GroupObject.** Image needs the resource the hash points at,
  which lives outside `Screen.dat`. GroupObject's children are not in the
  captured example; the file has to be read with one open.
- **Grid containers** (`DockPanel`, `Grid`, `StackPanel`): `Location: {Row,
  Column}` has no meaning on an absolute canvas until the reader models grids.
- **Equipment classes as data** with confidence, and `.xvm` ingest with DDT
  structure. Needs a Control Expert export to test against.

### Status (17 September 2026)

| # | State | Where |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
