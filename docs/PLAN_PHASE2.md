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
| 1 | done | `foreign` in the reader, the store and the persisted project; hatched placeholders in `ScreenRenderer`; "Carried, not editable" in the layers panel; `tests/foreign.test.ts` |
| 2 | done | `POST /api/import/screens`, `importScreens` in the store, Import on the screen strip with `ImportScreensDialog`; `tests/import-screens.test.ts` |
| 3 | done | `scripts/record-session.mts`; two sessions recorded against Gemini Flash Lite in `tests/transcripts/recorded-*.json` and replayed by `tests/transcripts.test.ts`. The first run found two applier faults in three turns (below) |
| 4 | done | `lib/tags/table.ts` (exceljs for spreadsheets, own delimiter-sniffing reader for text); `parseTagsFile` async for both, `parseTags` sync for text; `xlsx` removed. Left in `npm audit --omit=dev`: `postcss` inside Next and `uuid` inside exceljs, both transitive, neither reachable from a tag file |

### What the first recorded sessions found (17 September 2026)

Three turns on the full demo screen, Gemini Flash Lite, and two of them
exposed the applier rather than the model:

- **"add a lamp ... in the header" was refused.** A lamp's default size is the
  body's 180x64; the header is 44 high. The slot resolver now sizes a part to
  its region (`fitTo` in `regions.ts`), with the same top margin the free-slot
  search applies, so a header lamp is a 64x24 lamp. The model also bound the
  lamp by the handle it guessed its own add would get (`o21`); a handle that
  does not exist, in a batch that created exactly one object, now resolves to
  that object.
- **"make the flow reading bold" was reported done and did nothing.** The
  model sent `resizeObject` with no size, and the applier applied it. A resize
  with no width or height is now refused, with the reason naming `setText`
  with `bold` or `fontSize`, and `setText` restyles every face of a lamp, a
  switch, an N-state lamp or a display without relabelling it.

After the fixes the same three requests all land on the first try. The
recorded transcript is the regression test: `tests/recorded-findings.test.ts`
holds the applier side, and the replay holds the model's actual answers.
