# web — the HMI Copilot product

Next.js full stack. See [`../docs/BUILD_PLAN.md`](../docs/BUILD_PLAN.md) for the phases
and [`../docs/ui-reference/`](../docs/ui-reference/) for the agreed design.

## Setup

```bash
npm install
cp .env.example .env.local        # add your ANTHROPIC_API_KEY
npm run setup:skeleton            # pulls Blank.eote out of your OTE installation
npm run index:graphics            # indexes the 474 shipped graphic objects
npm run dev
```

Both setup scripts read a local **EcoStruxure Operator Terminal Expert 4.4**
installation. Set `OTE_INSTALL_DIR` if it is not at the default path. Their output is
gitignored — those are Schneider's files, extracted per machine, never redistributed.

## Where things live

```
src/lib/ote/        the format layer - a port of ../tools/make_project.py
  schema.ts         zod schemas; the model generates against these
  palette.ts        ColorSet 4 "Green-Simple", index -> hex
  graphics.ts       .path Commands + Points -> SVG path data
  bindings.ts       Sources -> Bindings -> Targets graph
  packager.ts       jszip + sql.js -> .eote
src/components/
  canvas/           Screen.dat -> inline SVG, one node per object
  intent/           describe, import tags, pick standards
  inspector/        properties and bindings
  timeline/         the build timeline
src/store/          zustand + immer, the project tree
src/app/api/        generate (SSE), export (nodejs), tags/parse, validate
tests/              packager.test.ts is the Phase 1 gate
```

## The one rule

**The canvas may only render what the packager can emit.** The pitch is "one model, two
renderers — the preview cannot lie about the output". A visual with no OTE part behind
it turns the product back into a mockup, and a judge who opens the exported file will
find out.

## Two traps that already cost us once

1. **ZIP entry names use backslashes.** Verify against the raw bytes
   (`text.includes("Screens\\")`), not against the library's name list.
2. **Quote every SQL column.** `Order` and `Value` are keywords, and SQLite returns an
   unknown double-quoted identifier as a *string literal* instead of erroring — which is
   how a deck once printed the word "SetPoint" in every setpoint cell.
