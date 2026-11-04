// Audit 2026-11, stream S6: draw the screens the generator makes and measure how they look.
// Renders through the app's own rasteriser (lib/critic/render.ts), in-process, with no model:
// run with the AI keys blank so the deterministic fallback plan is used and no quota is spent.
//
//   cd web && MONGODB_URI= GEMINI_API_KEY= ANTHROPIC_API_KEY= \
//     npx tsx --tsconfig scripts/tsconfig.json scripts/audit/s6-render.mts <outDir>
//
// Writes <outDir>/<name>.png and <outDir>/metrics.json. Nothing is written into the repo.
// The symbol demo uses the gitignored graphics index when present; its PNG stays in outDir.
import fs from "node:fs";
import path from "node:path";
import { screenToPng, screenToSvg } from "../../src/lib/critic/render";
import { demoScreen } from "../../src/fixtures";
import { buildDemoProject } from "../../src/lib/ote/demo-project";
import { buildFromTags } from "../../src/lib/agent/build";
import { parseTags } from "../../src/lib/tags/parse";
import { pathPart, rectangle, screenOf, textBox } from "../../src/lib/ote/parts";
import { DARK_GREY, GREEN, INK, WHITE, resolveColor } from "../../src/lib/ote/palette";
import type { Part, Screen } from "../../src/lib/ote/schema";
import { readProject } from "../../src/lib/ote/reader";
import { critiqueGeometry } from "../../src/lib/critic/geometry";
import type { ForeignPart } from "../../src/store/types";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: s6-render.mts <outDir> [project.eote ...]");
/** Projects to draw instead of the generated set: an engineer's file is measured the same way. */
const PROJECTS = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });

const WEB = path.resolve(import.meta.dirname, "..", "..");
const PANEL = { model: "HMIST6500AWADI", width: 1024, height: 600 };
const screens: { name: string; screen: Screen; foreign?: ForeignPart[]; panel?: { width: number; height: number } }[] = [];

// An engineer's project: screens are numbered, never named, so no file here carries its text.
for (const [f, file] of PROJECTS.entries()) {
  const read = await readProject(new Uint8Array(fs.readFileSync(file)), path.basename(file));
  read.screens.forEach((s, i) => screens.push({ name: `eng${f + 1}-screen${i + 1}`, screen: s, foreign: read.foreign[s.UniqueId] as unknown as ForeignPart[], panel: read.target }));
}
if (PROJECTS.length === 0) {

screens.push({ name: "fixture-pump-station", screen: demoScreen });
for (const s of buildDemoProject().screens) screens.push({ name: "demo-project", screen: s });

// build-symbol-demo.mts, without the packaging step.
const INDEX = path.join(WEB, "src", "lib", "ote", "graphics-index.json");
if (fs.existsSync(INDEX)) {
  const { symbols } = JSON.parse(fs.readFileSync(INDEX, "utf8")) as { symbols: { name: string; category: string; Commands: string; Points: string }[] };
  const picked = ["Pumps", "Tanks", "Valves", "Fans"].map((c) => symbols.find((s) => s.category.endsWith(c))).filter((s) => s !== undefined);
  const parts: Part[] = [
    rectangle("Banner", { left: 0, top: 0, width: 1024, height: 56 }, { fill: GREEN, border: GREEN }),
    textBox("Title", "Shipped symbol library", { left: 20, top: 14, width: 520, height: 30 }, { size: 20, colour: WHITE, bold: true }),
  ];
  picked.forEach((symbol, i) => {
    const left = 40 + i * 240;
    parts.push(rectangle(`Panel_${i}`, { left, top: 96, width: 200, height: 260 }));
    parts.push(pathPart(`Sym_${i}`, symbol, { left: left + 20, top: 120, width: 160, height: 160 }));
    parts.push(textBox(`Lbl_${i}`, `symbol ${i + 1}`, { left: left + 20, top: 296, width: 160, height: 24 }, { size: 13, colour: INK }));
    parts.push(textBox(`Cat_${i}`, ["Pumps", "Tanks", "Valves", "Fans"][i], { left: left + 20, top: 320, width: 160, height: 22 }, { size: 11, colour: DARK_GREY }));
  });
  screens.push({ name: "symbol-demo", screen: screenOf("SymbolLibrary", parts, PANEL) });
}

// build-bar-demo.mts and the other tracked samples, through the same pipeline the browser runs.
const SAMPLES: [string, string][] = [
  ["transfer-pump-station", "transfer pump station, with a faceplate for PMP_101"],
  ["tank-farm", "tank farm overview"],
  ["water-treatment", "water treatment plant"],
  ["boiler-house", "boiler house"],
];
for (const [sample, intent] of SAMPLES) {
  const csv = path.join(WEB, "..", "samples", sample, "tags.csv");
  if (!fs.existsSync(csv)) continue;
  const { variables } = parseTags(fs.readFileSync(csv), "tags.csv");
  const built = await buildFromTags({ name: sample, intent, variables, panel: PANEL });
  built.input.screens.forEach((s, i) => screens.push({ name: `${sample}-${i + 1}-L`, screen: s }));
}

}

/* --- measurement ----------------------------------------------------------- */

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const idx = (node: unknown, key: string): number | undefined => {
  const v = (node as Record<string, { Color?: { Value?: unknown } }> | undefined)?.[key]?.Color?.Value;
  return typeof v === "number" ? v : undefined;
};
/** Every face a part paints: the part itself, or its Off/On, Release/Press, States. */
const faces = (p: Record<string, unknown>): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = [p];
  for (const k of ["Off", "On", "Release", "Press", "Invalid"]) if (p[k] && typeof p[k] === "object") out.push(p[k] as Record<string, unknown>);
  if (Array.isArray(p.States)) out.push(...(p.States as Record<string, unknown>[]));
  return out;
};
const countBy = <T,>(xs: T[]) => Object.fromEntries([...xs.reduce((m, x) => m.set(String(x), (m.get(String(x)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]));

const metrics: Record<string, unknown>[] = [];
for (const [n, { name, screen, foreign, panel = PANEL }] of screens.entries()) {
  const file = `${String(n).padStart(2, "0")}-${name}`;
  const around = { contents: screens.map((s) => s.screen), panel: { width: panel.width, height: panel.height } };
  fs.writeFileSync(path.join(OUT, `${file}.png`), await screenToPng(screen, foreign, 1, around));
  const svg = await screenToSvg(screen, foreign, around);
  fs.writeFileSync(path.join(OUT, `${file}.svg`), svg);

  const parts = screen.Children[0].Children as unknown as (Record<string, unknown> & { Type: string; Location: { Left: number; Top: number }; Width?: number; Height?: number })[];
  const colourIdx: number[] = [];
  const fonts: number[] = [];
  const strokes: number[] = [];
  const lowContrastText: string[] = [];
  for (const p of parts) {
    for (const f of faces(p)) {
      for (const k of ["Fill", "Border", "TextColor", "Stroke"]) { const c = idx(f, k); if (c !== undefined) colourIdx.push(c); }
      const size = (f.Font as { Size?: number } | undefined)?.Size;
      if (typeof size === "number") fonts.push(size);
      if (typeof f.Thickness === "number") strokes.push(f.Thickness as number);
      const t = idx(f, "TextColor");
      const bg = idx(f, "Fill");
      if (t !== undefined && bg !== undefined) {
        const r = contrast(resolveColor(t), resolveColor(bg));
        if (r < 4.5) lowContrastText.push(`${p.Type} ${r.toFixed(2)}`);
      }
    }
  }
  const boxes = parts.filter((p) => p.Width !== undefined);
  const on8 = (v: number) => v % 8 === 0;
  const edges = boxes.flatMap((p) => [p.Location.Left, p.Location.Top, p.Width ?? 0, p.Height ?? 0]);
  const lefts = new Set(boxes.map((p) => p.Location.Left));
  // Text that is wider than its box at ~0.55em per glyph: clipped or overflowing labels.
  const overflow = parts.filter((p) => p.Type === "TextBox").filter((p) => {
    const size = (p.Font as { Size?: number } | undefined)?.Size ?? 12;
    const longest = String(p.Text ?? "").split("\n").reduce((m, l) => Math.max(m, l.length), 0);
    return longest * size * 0.55 > (p.Width ?? 0);
  }).length;
  const geometry = critiqueGeometry(screen);
  metrics.push({
    file,
    criticScore: geometry.score,
    criticFindings: countBy(geometry.findings.map((f) => f.rule)),
    panel: `${panel.width}x${panel.height}`,
    carried: foreign?.length ?? 0,
    parts: parts.length,
    types: countBy(parts.map((p) => p.Type)),
    paletteIndices: countBy(colourIdx),
    distinctColours: new Set(colourIdx).size,
    hexes: [...new Set(colourIdx)].map((c) => resolveColor(c)),
    fontSizes: countBy(fonts),
    distinctFontSizes: new Set(fonts).size,
    strokes: countBy(strokes),
    roundedRects: (svg.match(/<rect[^>]*\srx="[1-9]/g) ?? []).length,
    rects: (svg.match(/<rect/g) ?? []).length,
    svgStrokeWidths: countBy([...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => m[1])),
    onGrid8Pct: Math.round((100 * edges.filter(on8).length) / Math.max(1, edges.length)),
    distinctLeftEdges: lefts.size,
    lowContrastText: countBy(lowContrastText),
    textOverflow: overflow,
    emptyBars: parts.filter((p) => (p.Animation as { FillLevel?: { VerticalFill?: number; HorizontalFill?: number } } | undefined)?.FillLevel && ((p.Animation as { FillLevel: { VerticalFill?: number; HorizontalFill?: number } }).FillLevel.VerticalFill ?? (p.Animation as { FillLevel: { HorizontalFill?: number } }).FillLevel.HorizontalFill) === 0).length,
  });
}
fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 1));
console.log(`${metrics.length} screens rendered to ${OUT}`);
for (const m of metrics) console.log(`${m.file}: ${m.parts} parts, ${m.distinctColours} colours, ${m.distinctFontSizes} font sizes, grid8 ${m.onGrid8Pct}%, rounded ${m.roundedRects}/${m.rects}, critic ${m.criticScore} ${JSON.stringify(m.criticFindings)}`);
