# Phase 1: read before write

*The next plan, written 17 September 2026 after Phase 0 of `LLD.md` landed.
`REENGINEERING.md` §6 says what the phases are; this is the concrete order for
the first one, with the acceptance test for each item.*

Phase 0 made the conversation trustworthy. Phase 1 makes the product usable on
a project that already exists, which is most projects. The order is by what
unblocks the next thing and by what the Schneider conversation needs first.

| # | Item | Why now | Done when |
|---|---|---|---|
| 1 | **`.eote` reader with byte-identical round trip** | Brownfield is the market; "open your own sample project and get it back unchanged" is the demo that earns the meeting | `tests/reader.test.ts`: read `demo_project/HMICopilot_PumpStation.eote`, export with no change, every ZIP entry byte-identical; add one object to one screen, exactly that `Screen.dat` differs; an unknown part type survives the trip in its original position |
| 2 | **Open a project in the app** | The reader is useless without a door | Projects page has "Open .eote"; the opened project edits, validates and exports through the same store; export of an opened project starts from its own entries, not the skeleton |
| 3 | **Navigation refresh after extend** | Extend adds screens but the old screens' navigation strips still list only the old set | `tests/navigation.test.ts`: after an extend, every generated screen's strip lists every screen, and nothing else on those screens moved |
| 4 | **Proposal ghosting on the canvas** | A proposal is a list today; the engineer should see where things would land | Added objects drawn dashed on the active screen while a proposal is pending; accept commits, discard clears, nothing ghosted reaches the store |
| 5 | **`find_tags` / `find_objects` lookup tools (Claude path)** | Retrieval is deterministic pre-selection; a request about a tag no word matches still fails | On the 1,248-tag sample, a request naming a tag only by its comment binds it, via one tool call, bounded to four per turn |
| 6 | **Recorded sessions** | The three transcripts are hand-written | Ten real sessions recorded against Gemini and Claude, replayed in CI |
| 7 | **Part coverage: Switch, N-StateLamp, StringDisplay** | The first three of the twelve in `REENGINEERING.md` §4.3, each against a captured example | Each parses from `reference/part_examples.json`, renders, round-trips byte-identical, and the canvas compiles only once it draws them |

Items 1 to 3 are this pass. 4 and 5 follow. 6 needs an afternoon with keys.
7 starts the part-coverage track that continues into Phase B.

### Status (17 September 2026)

| # | State | Where |
|---|---|---|
| 1 | done | `lib/ote/reader.ts`, `packagePreserved` in `packager.ts`, `syncVariables` / `syncAlarms`; `tests/reader.test.ts` holds the byte-identical round trip, the one-entry edit, an unknown part surviving in place, an unknown property surviving on a known part, a tag added without disturbing ids, a screen dropped cleanly |
| 2 | done | `POST /api/import` keeps the bytes under `web/.imports/`; "Open .eote" on the Projects page; export of an opened project writes back into its file |
| 3 | done | `refreshNavigation` in `layout.ts`, store action, called after every extension; `tests/navigation.test.ts` |
| 4 | done | `previewOf` in `applier.ts`; ghosts drawn by `ScreenRenderer` (added translucent with a dashed outline, removed hatched, moved outlined with a line from where they are); cleared on accept, discard, or the next request; `tests/preview.test.ts` |
| 5 | done | `find_tags` and `find_objects` as strict tools in a bounded lookup phase before the propose call on the Claude path; the client sends a compact catalog that never enters the prompt; scoring weights said words over synonyms, rare words over common, with prefix credit and whole-word matching |
| 6 | open | needs keys and an afternoon |
| 7 | done | `Switch`, `N-StateLamp`, `StringDisplay` in `schema.ts` against the captured examples; constructors, renderers, toolbar, shortcuts, layers, validation and the applier all know them; `tests/parts.test.ts` parses the product's own property names, renders each state, checks type rules and round-trips them through an opened project. Doing this exposed that the product writes `Fill: {Type: 0}` for none and `{Type: 5, …}` for a gradient, so `Paint` is now a union that carries typed paints through and the canvas draws none as none |

Next on the part track, in operator value order: BarScale, TrendGraph, BlockTrend,
Pipe, Image, DateTimeDisplay, GroupObject, DockPanel, ToggleSwitch.

## Reader design, in short

- Read the whole ZIP. Every entry's bytes are kept in `preserved.entries`.
- Model what the store understands: screens (parts the schema knows), variables
  (rows with a data type the schema knows), alarms, part and alarm bindings.
- Everything else is carried: unknown parts stay in their screen's raw JSON at
  their index; unknown variable rows stay in `Variables.db`; unknown binding
  rows stay in `Bindings.dat`; every other entry is untouched.
- The writer starts from `preserved.entries`, not the skeleton, and rewrites an
  entry only when the modelled content it holds has changed. Fingerprints of
  the modelled content are taken at read time and compared at write time.
- When a screen is rewritten, each known part is the store's version merged
  over the original JSON, so properties the schema does not model survive.
- When variables or alarms are rewritten, rows are synchronised, not replaced:
  unknown rows are never deleted, surviving rows keep their UniqueId.
- When bindings are rebuilt, the rows the reader could not model are appended
  with their reference ids remapped.

The invariant, as a test: *open, export, compare: identical. Open, change one
thing, export, compare: one entry differs.*
