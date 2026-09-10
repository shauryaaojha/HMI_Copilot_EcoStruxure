# web — the HMI Copilot product

Next.js full stack. See [`../docs/BUILD_PLAN.md`](../docs/BUILD_PLAN.md) for the phases,
[`../docs/ui-reference/`](../docs/ui-reference/) for the agreed design, and
[`../README.md`](../README.md#status) for what is done and what is not — that table is
kept in one place so it cannot go stale in two.

```bash
npm test        # 148 pass with the app running; the 9 skipped are the Phase 1 gate
```

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
src/lib/sim/        the simulation engine and alarm evaluation - no format knowledge
src/components/
  ui/               the eight primitives everything else is built from
  shell/            top bar, nav rail, the resizable workspace, theme
  canvas/           Screen.dat -> inline SVG, one node per object
    parts/          one component per part type, chosen by an exhaustive switch
  intent/           describe, import tags, pick standards
  inspector/        property groups generated from the zod schemas
  generation/       the SSE consumer, and the local emitter it falls back to
  tags/             import, table, summary
  bindings/         the binding map, ported from tools/make_binding_map.py
  validation/       findings, grouped and clickable back to the object
  export/           the export screen and the Variables.csv writer
  templates/        equipment templates, built from lib/ote/parts.ts factories
  timeline/         the build timeline
src/store/          zustand + immer, the project tree
src/app/api/        generate (SSE), export (nodejs), tags/parse, validate
public/demo/        Plant_Tags.csv - the 1,248-tag sample export
tests/              packager.test.ts is the Phase 1 gate;
                    demo-path.test.ts is the Phase 10 rehearsal
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
