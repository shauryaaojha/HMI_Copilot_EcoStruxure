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
