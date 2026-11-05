import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import { sceneOf, inverseTransform, sceneTree, transformPoint } from "@/lib/layout/scene";
import { layoutFacts, nearMisses, printLayoutFacts } from "@/lib/layout/facts";
import { layoutTree } from "@/lib/ote/containers";
import type { Part, Screen } from "@/lib/ote/schema";
import { critiqueGeometry } from "@/lib/critic/geometry";

const files = ["PumpStation", "Bars", "TS", "Symbols"].map((name) =>
  path.join(__dirname, "..", "..", "demo_project", "HMICopilot_" + name + ".eote"));

describe("read-only layout scenes", () => {
  for (const file of files) it("keeps every resolved leaf box from " + path.basename(file), async () => {
    const project = await readProject(new Uint8Array(fs.readFileSync(file)));
    for (const screen of project.screens) {
      const preserved = project.preserved.screens.get(screen.UniqueId);
      const scene = sceneOf({ screen, panel: project.target, preserved, opened: true, contentScreens: project.screens });
      const flat = new Map(screen.Children[0].Children.map((part) => [part.UniqueId, part]));
      for (const part of flat.values()) {
        const node = scene.nodes.get(part.UniqueId);
        expect(node?.box, part.Name).toEqual({ left: part.Location.Left, top: part.Location.Top, width: part.Width ?? 0, height: part.Height ?? 0 });
      }
      if (preserved?.tree) {
        const raw = (preserved.raw.Children as Record<string, unknown>[])[0];
        const laid = layoutTree(raw, { left: 0, top: 0, ...scene.size });
        for (const leaf of laid.leaves) if (flat.has(leaf.uid)) expect(scene.nodes.get(leaf.uid)?.box).toEqual(leaf.box);
      }
      for (const point of [{ x: 0, y: 0 }, { x: scene.size.width / 3, y: scene.size.height / 2 }]) {
        const roundTrip = transformPoint(transformPoint(point, scene.toPanel), inverseTransform(scene.toPanel));
        expect(Math.abs(roundTrip.x - point.x)).toBeLessThan(1e-9);
        expect(Math.abs(roundTrip.y - point.y)).toBeLessThan(1e-9);
      }
      const facts = layoutFacts(scene, screen.Children[0].Children, project.target.model ?? "panel");
      expect(printLayoutFacts(facts)).toBe(printLayoutFacts(layoutFacts(scene, screen.Children[0].Children, project.target.model ?? "panel")));
    }
  });

  it("matches the S5 near-miss count across the four tracked projects", async () => {
    let count = 0;
    for (const file of files) {
      const project = await readProject(new Uint8Array(fs.readFileSync(file)));
      count += project.screens.reduce((sum, screen) => sum + nearMisses(screen.Children[0].Children).length, 0);
    }
    expect(count).toBe(84);
  });

  it("resolves a Grid cell and nested CO and content transforms", () => {
    const raw = { Type: "Grid", UniqueId: "root", Name: "Root", Rows: [{}, {}], Columns: [{}, {}], Children: [
      { Type: "CompoundObject.Switch", UniqueId: "co", Name: "Start", Location: { Row: 1, Column: 1 }, Width: 100, Height: 40 },
      { Type: "ContentDisplay", UniqueId: "display", Name: "Content", Location: { Row: 0, Column: 0 }, Width: 100, Height: 50, ScreenId: 7 },
    ] };
    const laid = layoutTree(raw, { left: 0, top: 0, width: 400, height: 200 });
    const co = { Type: "CompoundObject", UniqueId: "co", Name: "Start", Definition: "Switch", Location: { Left: 250, Top: 130 }, Width: 100, Height: 40,
      Look: { width: 50, height: 20, uniform: true, items: [] } } as unknown as Part;
    const display = { Type: "ContentDisplay", UniqueId: "display", Name: "Content", ScreenId: 7, Location: { Left: 50, Top: 25 }, Width: 100, Height: 50 } as unknown as Part;
    const screen = { Type: "Screen", UniqueId: "screen", Name: "S", Children: [{ Type: "ViewBox", UniqueId: "root", Width: 400, Height: 200, Children: [co, display] }] } as Screen;
    const content = { Type: "Content", UniqueId: "content", ContentID: 7, Name: "C", Children: [{ Type: "ViewBox", Width: 200, Height: 100, Children: [] }] } as unknown as Screen;
    const scene = sceneOf({ screen, panel: { width: 800, height: 600 }, preserved: { raw: { Children: [raw] }, tree: { laid, modelled: new Set(["co", "display"]) } } as never, contentScreens: [content] });
    expect(scene.nodes.get("co")?.slot).toMatchObject({ kind: "cell", row: 1, column: 1 });
    expect(scene.nodes.get("co")?.inner?.toHost.sx).toBe(2);
    expect(scene.nodes.get("display")?.inner).toMatchObject({ sceneId: "content", toHost: { sx: 0.5, sy: 0.5 } });
    expect(sceneTree(scene).map((row) => row.id)).toContain("display::content:content");
    expect(scene.toPanel).toEqual({ sx: 2, sy: 2, tx: 0, ty: 100 });
    const inner = scene.nodes.get("co")!.inner!.toHost;
    expect(transformPoint(transformPoint({ x: 11, y: 7 }, inner), inverseTransform(inner))).toEqual({ x: 11, y: 7 });
    const printed = printLayoutFacts(layoutFacts(scene, [co, display], "800x600"));
    expect(printed).toContain("ViewBox letterbox scale is assumed");
    expect(printed).toMatchSnapshot();
  });

  it("counts text near misses the same way as the S5 measurement", () => {
    const part = (id: string, left: number) => ({ Type: "TextBox", UniqueId: id, Name: id, Location: { Left: left, Top: 10 }, Width: 20, Height: 10 }) as Part;
    const screen = { Type: "Screen", UniqueId: "s", Name: "S", Children: [{ Type: "ViewBox", Width: 100, Height: 100, Children: [part("a", 10), part("b", 12)] }] } as Screen;
    expect(nearMisses(screen.Children[0].Children)).toHaveLength(1);
    expect(critiqueGeometry(screen).findings.some((finding) => finding.rule === "geom.nearMiss")).toBe(true);
  });

  it("projects a stable read-only tree with Compound Object instances", () => {
    const co = { Type: "CompoundObject", UniqueId: "co", Name: "Start", Definition: "Switch", Location: { Left: 20, Top: 30 }, Width: 80, Height: 40,
      Look: { width: 40, height: 20, uniform: false, items: [{ kind: "part", part: { Type: "TextBox", UniqueId: "inner", Name: "Inner", Location: { Left: 4, Top: 2 }, Width: 12, Height: 8 } }] } } as unknown as Part;
    const leaf = { Type: "TextBox", UniqueId: "label", Name: "Label", Location: { Left: 10, Top: 10 }, Width: 40, Height: 16 } as Part;
    const screen = { Type: "Screen", UniqueId: "s", Name: "S", Children: [{ Type: "ViewBox", UniqueId: "view", Width: 200, Height: 100, Children: [leaf, co] }] } as Screen;
    const tree = sceneTree(sceneOf({ screen, panel: { width: 200, height: 100 } }));
    expect(tree.map((row) => [row.id, row.depth, row.node.kind])).toEqual([
      ["view", 0, "container"], ["label", 1, "part"], ["co", 1, "coInstance"], ["co::inner", 2, "part"],
    ]);
  });
});
