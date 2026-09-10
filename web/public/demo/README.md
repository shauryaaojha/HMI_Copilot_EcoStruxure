# Sample tag exports

Committed plant exports, so a demo never depends on finding a file in an OS file
dialog and so `lib/tags/parse.ts` is exercised against more than one shape of
file. They are offered in the app from the Tags screen and the import panel.

These are not variations on a theme — between them they cover every path the
importer has.

| File | Plant | Tags | Format | What it exercises |
|---|---|---|---|---|
| `Plant_Tags.csv` | Water treatment | 1,248 | CSV, header | scale, and the five names the corrector reports |
| `Bottling_Line.xlsx` | Bottling line | 82 | XLSX | the spreadsheet path through SheetJS |
| `Conveyor_System.csv` | Conveyor system | 125 | CSV, `;` | the delimiter Excel writes on a European locale |
| `Batch_Reactors.txt` | Batch reactors | 86 | TSV, header | `Symbol`/`Type` column naming rather than `Name`/`DataType` |
| `Boiler_House.txt` | Boiler house | 49 | TSV, **no header** | the positional fallback: name, type, comment, address |
| `Legacy_Retrofit.csv` | Legacy panel retrofit | 66 | CSV, awkward | corrections, duplicates and unusable rows |

Every figure above is what `POST /api/tags/parse` actually returns, not what the
files contain — `Legacy_Retrofit.csv` has 70 rows and yields 66 tags, because
four carry types the normaliser cannot place and are reported rather than
guessed at. `tests/samples.test.ts` holds all six to these numbers, so a change
to the parser that quietly alters what an import produces fails there.

## The prompt that goes with each one

A tag export on its own does not demo. Each sample carries the sentence it was
written for, in `SAMPLES` in `src/components/tags/useTagImport.ts`, and the
Copilot offers it once that sample is the import — the generic openers stay for
everything else, because a project with no tags should not suggest equipment it
does not have.

Every one was run through `POST /api/generate` against its own parsed tags:

| Sample | Screen produced | Objects | Bindings |
|---|---|---|---|
| Water treatment | `PumpStation1` | 29 | 8 |
| Bottling line | `BottlingLineOverview` | 51 | 16 |
| Conveyor system | `ConveyorOverview` | 31 | 7 |
| Batch reactors | `ReactorScreen` | 22 | 4 |
| Boiler house | `BoilerHouseOverview` | 31 | 6 |
| Legacy retrofit | `MotorControlScreen` | 26 | 5 |

All eight pipeline steps complete on all six, in one and a half to three and a
half seconds.

### Asking for the whole application

`lib/ai/plan.ts` plans a screen hierarchy — overview first, then areas, capped at
six units a screen because that is what ISA-101 warns against — but only when
the request asks for one. Five of the samples carry a second prompt that does,
and these are the screens they actually produced:

| Sample | Screens | Objects | What it built |
|---|---|---|---|
| Water treatment | **7** | 245 | `PlantOverview` + intake, transfer, filtration, chemical dosing, distribution, backwash |
| Bottling line | **5** | 214 | `LineOverview` + fillers, cappers, labellers, CIP |
| Boiler house | **3** | 112 | `BoilerHouseOverview` + boiler detail, feedwater and deaerator |
| Batch reactors | **3** | 85 | `PlantOverview` + reactor detail, dosing pumps |
| Conveyor system | **3** | 81 | `PlantOverview` + conveyors, sort and weigh |

The legacy retrofit has no such prompt on purpose. It is a two-motor panel; a
hierarchy over it would be padding, and `tests/samples.test.ts` asserts it stays
absent.

Note that the reactor prompt asks for a screen per reactor and gets one
`ReactorDetail` for all four. That is the units-per-screen rule working, not
failing.

`tests/samples.test.ts` checks each intent names equipment the file actually
contains, and — for the retrofit, which loses its tank and valve tags to
unusable types — that it does not promise equipment the import dropped. A prompt
that asks for a tank the file has no tags for produces a screen bound to
nothing, and the engineer blames the model rather than the sentence.

## Why the awkward one matters

`Legacy_Retrofit.csv` is deliberately what a twenty-year-old panel database
looks like on export:

- names with spaces, hyphens and OPC-style dots
- a name beginning with a digit
- `Order` and `Value`, which are SQL keywords
- the same tag listed three times
- types spelled `Analogue`, `boolean16`, `flt` and `??`

The importer corrects the names, deduplicates with a suffix, and **skips the
four unusable rows with a reason attached** rather than defaulting them to
something plausible. That behaviour — reported, never silent — is the single
most trust-relevant thing the product does, and this file is how it is
demonstrated and how it is tested.

## Regenerating

The files are the artefact and are checked in. If a plant needs adding, write
the file, add a row to `SAMPLES` in `src/components/tags/useTagImport.ts`, and
add its expected parse result to `tests/samples.test.ts` — the test is the
contract, not the generator.
