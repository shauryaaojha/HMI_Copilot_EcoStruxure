/**
 * S3 geometry measurement: is a screen aligned / overlap-free / inside the panel, in numbers.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/audit/s3-geometry.mts list <file.eote|project.json>
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/audit/s3-geometry.mts parts <file> <screen>
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/audit/s3-geometry.mts measure <before> <after> --screen <name|id> [--match start,stop] [--json out.json]
 *
 * <before>/<after> are an .eote (read with the app's own reader) or a JSON file holding
 * { target, screens } - the shape /api/import and the agent's "saved" event return.
 * Only a screen's top-level parts are measured (the reader's model). A part whose box covers at
 * least half the panel is treated as a background and left out of overlap counts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readProject } from "@/lib/ote/reader";
import type { Part, Screen } from "@/lib/ote/schema";

type Box = { left: number; top: number; width: number; height: number };
interface Loaded { target: { width: number; height: number }; screens: Screen[] }

export async function load(path: string): Promise<Loaded> {
  if (/\.json$/i.test(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const p = raw.project ?? raw;
    return { target: p.target, screens: p.screens };
  }
  const read = await readProject(new Uint8Array(readFileSync(path)), path);
  return { target: read.target, screens: read.screens };
}

export const boxOf = (p: Part): Box => ({ left: p.Location?.Left ?? 0, top: p.Location?.Top ?? 0, width: p.Width ?? 0, height: p.Height ?? 0 });
const textOf = (p: Part): string => {
  const t = (p as { Text?: unknown }).Text;
  if (typeof t === "string") return t;
  if (t && typeof t === "object") return Object.values(t as Record<string, unknown>).filter((v) => typeof v === "string").join(" / ");
  return "";
};
const inter = (a: Box, b: Box) => {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
};
const holds = (a: Box, b: Box) => b.left >= a.left && b.top >= a.top && b.left + b.width <= a.left + a.width && b.top + b.height <= a.top + a.height;

export function findScreen(l: Loaded, ref: string): Screen {
  const s = l.screens.find((x) => x.Name.toLowerCase() === ref.toLowerCase() || x.UniqueId.toLowerCase() === ref.toLowerCase());
  if (!s) throw new Error(`no screen ${ref}; have ${l.screens.map((x) => x.Name).join(", ")}`);
  return s;
}

export function measureScreen(screen: Screen, panel: { width: number; height: number }) {
  const view = screen.Children[0] as { Width?: number; Height?: number; Children: Part[] };
  const W = view.Width ?? panel.width, H = view.Height ?? panel.height;
  const parts = view.Children;
  const big = (b: Box) => b.width * b.height >= (W * H) / 2;
  const oob = parts.filter((p) => { const b = boxOf(p); return b.left < 0 || b.top < 0 || b.left + b.width > W || b.top + b.height > H; }).map((p) => p.Name);
  const pairs: { a: string; b: string; area: number; labels: boolean }[] = [];
  let contained = 0;
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = boxOf(parts[i]), b = boxOf(parts[j]);
    if (big(a) || big(b)) continue;
    const area = inter(a, b);
    if (!area) continue;
    if (holds(a, b) || holds(b, a)) { contained++; continue; }
    pairs.push({ a: parts[i].Name, b: parts[j].Name, area, labels: parts[i].Type === "TextBox" || parts[j].Type === "TextBox" });
  }
  return {
    panel: { width: W, height: H }, parts: parts.length,
    outOfBounds: oob.length, outOfBoundsNames: oob,
    overlaps: pairs.length, overlapArea: pairs.reduce((n, p) => n + p.area, 0),
    labelOverlaps: pairs.filter((p) => p.labels).length, labelOverlapArea: pairs.filter((p) => p.labels).reduce((n, p) => n + p.area, 0),
    containedPairs: contained, overlapPairs: pairs,
  };
}

/** The first top-level part whose name or text matches each term (case-insensitive). */
export function matchParts(screen: Screen, terms: string[]) {
  const parts = (screen.Children[0] as { Children: Part[] }).Children;
  return terms.map((t) => {
    const re = new RegExp(t, "i");
    const p = parts.find((x) => x.Type !== "TextBox" && (re.test(x.Name) || re.test(textOf(x)))) ?? parts.find((x) => re.test(x.Name) || re.test(textOf(x)));
    return { term: t, id: p?.UniqueId, name: p?.Name, type: p?.Type, box: p ? boxOf(p) : undefined };
  });
}

export function alignment(boxes: Box[]) {
  if (boxes.length < 2) return null;
  const spread = (f: (b: Box) => number) => { const v = boxes.map(f); return Math.max(...v) - Math.min(...v); };
  return {
    dLeft: spread((b) => b.left), dRight: spread((b) => b.left + b.width), dCentreX: spread((b) => b.left + b.width / 2),
    dTop: spread((b) => b.top), dBottom: spread((b) => b.top + b.height), dMiddleY: spread((b) => b.top + b.height / 2),
    dWidth: spread((b) => b.width), dHeight: spread((b) => b.height),
    overlapArea: boxes.length === 2 ? inter(boxes[0], boxes[1]) : undefined,
  };
}

function moved(before: Screen, after: Screen) {
  const was = new Map((before.Children[0] as { Children: Part[] }).Children.map((p) => [p.UniqueId, JSON.stringify(boxOf(p))]));
  const now = (after.Children[0] as { Children: Part[] }).Children;
  return {
    moved: now.filter((p) => was.has(p.UniqueId) && was.get(p.UniqueId) !== JSON.stringify(boxOf(p))).map((p) => p.Name),
    added: now.filter((p) => !was.has(p.UniqueId)).length,
    removed: [...was.keys()].filter((id) => !now.some((p) => p.UniqueId === id)).length,
  };
}

async function main() {
  const [cmd, a, b, ...rest] = process.argv.slice(2);
  const opt = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === "list") {
    const l = await load(a);
    for (const s of l.screens) {
      const m = measureScreen(s, l.target);
      console.log(`${s.Name} [${s.UniqueId}] parts=${m.parts} oob=${m.outOfBounds} overlaps=${m.overlaps} (${m.overlapArea}px²) labelOverlaps=${m.labelOverlaps}`);
    }
    return;
  }
  if (cmd === "parts") {
    const l = await load(a);
    const s = findScreen(l, b);
    for (const p of (s.Children[0] as { Children: Part[] }).Children) {
      const x = boxOf(p);
      console.log(`${p.Type.padEnd(16)} ${p.Name.padEnd(28)} ${x.left},${x.top} ${x.width}x${x.height} ${JSON.stringify(textOf(p)).slice(0, 40)}`);
    }
    return;
  }
  if (cmd !== "measure") throw new Error("usage: list <file> | measure <before> <after> --screen <name> [--match a,b] [--json out]");
  const before = await load(a), after = await load(b);
  const ref = opt("--screen")!;
  const sb = findScreen(before, ref), sa = findScreen(after, ref);
  const terms = (opt("--match") ?? "").split(",").filter(Boolean);
  const mb = matchParts(sb, terms), ma = matchParts(sa, terms);
  const result = {
    screen: sb.Name,
    before: { ...measureScreen(sb, before.target), matched: mb, alignment: alignment(mb.flatMap((m) => (m.box ? [m.box] : []))) },
    after: { ...measureScreen(sa, after.target), matched: ma, alignment: alignment(ma.flatMap((m) => (m.box ? [m.box] : []))) },
    change: moved(sb, sa),
  };
  const out = opt("--json");
  if (out) writeFileSync(out, JSON.stringify(result, null, 2));
  const row = (k: string, f: (x: typeof result.before) => unknown) => console.log(`${k.padEnd(18)} ${String(f(result.before)).padStart(10)} ${String(f(result.after)).padStart(10)}`);
  console.log(`screen ${result.screen}            before      after`);
  row("parts", (x) => x.parts); row("out of bounds", (x) => x.outOfBounds); row("overlaps", (x) => x.overlaps);
  row("overlap px²", (x) => x.overlapArea); row("label overlaps", (x) => x.labelOverlaps); row("label overlap px²", (x) => x.labelOverlapArea);
  for (const k of ["dLeft", "dCentreX", "dTop", "dMiddleY", "dWidth", "dHeight", "overlapArea"] as const) row(k, (x) => x.alignment?.[k] ?? "-");
  console.log(`moved ${result.change.moved.length} (${result.change.moved.slice(0, 8).join(", ")}), added ${result.change.added}, removed ${result.change.removed}`);
}

// Self-check: two boxes 10 px apart on the left edge, overlapping 5x20.
{
  const al = alignment([{ left: 0, top: 0, width: 20, height: 20 }, { left: 10, top: 0, width: 20, height: 20 }])!;
  if (al.dLeft !== 10 || al.dTop !== 0 || al.overlapArea !== 200) throw new Error("s3-geometry self-check failed");
}

if (process.argv[1]?.includes("s3-geometry")) main().catch((e) => { console.error(e.message); process.exit(1); });
