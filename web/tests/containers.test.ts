/**
 * Screens laid out by containers. lib/ote/containers.ts.
 *
 * Every screen the product creates is rooted in a Grid. Simple.eote - the
 * project Schneider sent - is the shape these tests are built on: a 10x8 grid
 * of default "*" tracks, an Ellipse at Row 2 Column 2, a Rectangle at Row 5
 * Column 3, and neither has a Left, a Top or a size.
 */

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ALIGN_H, ALIGN_V, layoutTree, mergeTree } from "@/lib/ote/containers";
import { readProject } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";

const SCREEN = "5fdf4537-e975-4088-b47d-ec912f471866";
const ELLIPSE = "ccd5f1f6-b89d-4059-b663-3250cd28f325";
const RECT = "0f86a856-557c-463e-a1bc-5fe0ef7530fc";

const simpleScreen = () => ({
  Type: "Screen",
  UniqueId: SCREEN,
  Name: "Screen1",
  NavigationSwitch: { Label: "Screen1" },
  Children: [
    {
      Type: "Grid",
      UniqueId: "7251104b-86bb-4bff-8915-bdf2b229143b",
      Name: "Grid",
      Options: 104,
      Rows: Array.from({ length: 10 }, () => ({})),
      Columns: Array.from({ length: 8 }, () => ({})),
      Children: [
        { Type: "Ellipse", UniqueId: ELLIPSE, Name: "Ellipse1", Location: { Left: null, Top: null, Row: 2, Column: 2 } },
        { Type: "Rectangle", UniqueId: RECT, Name: "Rectangle1", Location: { Left: null, Top: null, Row: 5, Column: 3 } },
      ],
    },
  ],
});

const PANEL = { left: 0, top: 0, width: 1024, height: 600 };

describe("the layout", () => {
  it("puts a sizeless part across its whole cell", () => {
    const laid = layoutTree(simpleScreen().Children[0], PANEL);
    const rect = laid.leaves.find((l) => l.uid === RECT)!;
    // 1024 / 8 = 128 wide, 600 / 10 = 60 tall; Column 3, Row 5.
    expect(rect.box).toEqual({ left: 384, top: 300, width: 128, height: 60 });
  });

  it("reads pixel, star and weighted-star tracks", () => {
    const laid = layoutTree(
      {
        Type: "Grid",
        Rows: [{ Height: "40" }, { Height: "*" }, { Height: "3*" }],
        Columns: [{ Width: "100" }, {}],
        Children: [
          { Type: "Rectangle", UniqueId: "a", Location: { Row: 2, Column: 1 } },
          { Type: "Rectangle", UniqueId: "b", Location: { Row: 0, Column: 0, RowSpan: 2 } },
        ],
      },
      PANEL,
    );
    // 560 left for 4 stars: 140 per star.
    expect(laid.leaves[0].box).toEqual({ left: 100, top: 180, width: 924, height: 420 });
    expect(laid.leaves[1].box).toEqual({ left: 0, top: 0, width: 100, height: 180 });
  });

  it("honours an explicit size with the product's alignment enums and margin", () => {
    const laid = layoutTree(
      {
        Type: "Grid",
        Rows: [{}],
        Columns: [{}],
        Children: [
          { Type: "Rectangle", UniqueId: "c", Width: 100, Height: 50 }, // centre, middle by default
          {
            Type: "Rectangle",
            UniqueId: "d",
            Width: 100,
            Height: 50,
            Margin: { Left: 8, Top: 4 },
            ObjectAlignment: { Horizontal: ALIGN_H.left, Vertical: ALIGN_V.top },
          },
          { Type: "Rectangle", UniqueId: "e", Width: 100, Height: 50, ObjectAlignment: { Horizontal: ALIGN_H.right, Vertical: ALIGN_V.bottom } },
        ],
      },
      PANEL,
    );
    expect(laid.leaves[0].box).toEqual({ left: 462, top: 275, width: 100, height: 50 });
    expect(laid.leaves[1].box).toEqual({ left: 8, top: 4, width: 100, height: 50 });
    expect(laid.leaves[2].box).toEqual({ left: 924, top: 550, width: 100, height: 50 });
  });

  it("descends into nested grids, canvases and stacks", () => {
    const laid = layoutTree(
      {
        Type: "Grid",
        Rows: [{ Height: "100" }, {}],
        Columns: [{}],
        Children: [
          {
            Type: "Grid",
            Location: { Row: 1 },
            Rows: [{}],
            Columns: [{}, {}],
            Children: [
              { Type: "Canvas", Location: { Column: 1 }, Children: [{ Type: "Rectangle", UniqueId: "f", Location: { Left: 10, Top: 20 }, Width: 30, Height: 40 }] },
            ],
          },
          {
            Type: "StackPanel",
            Location: { Row: 0 },
            Orientation: 1,
            Children: [
              { Type: "Rectangle", UniqueId: "g", Width: 50 },
              { Type: "Rectangle", UniqueId: "h", Width: 70 },
            ],
          },
        ],
      },
      PANEL,
    );
    const at = (uid: string) => laid.leaves.find((l) => l.uid === uid)!.box;
    expect(at("f")).toEqual({ left: 522, top: 120, width: 30, height: 40 });
    expect(at("g")).toEqual({ left: 0, top: 0, width: 50, height: 100 });
    expect(at("h")).toEqual({ left: 50, top: 0, width: 70, height: 100 });
  });
});

describe("writing back", () => {
  const laidSimple = () => {
    const root = simpleScreen().Children[0] as Record<string, unknown>;
    return { root, laid: layoutTree(root, PANEL) };
  };
  const flat = (laid: ReturnType<typeof layoutTree>): Record<string, unknown>[] =>
    laid.leaves.map((l) => ({ ...l.raw, Location: { Left: l.box.left, Top: l.box.top }, Width: l.box.width, Height: l.box.height }));

  it("leaves an unmoved part placed by its cell, with no size of its own", () => {
    const { root, laid } = laidSimple();
    const out = mergeTree(root, laid, flat(laid), new Set([ELLIPSE, RECT]));
    expect(out).toEqual(root);
  });

  it("pins a moved part inside its cell where it was dropped", () => {
    const { root, laid } = laidSimple();
    const parts = flat(laid);
    const rect = parts.find((p) => p.UniqueId === RECT)!;
    rect.Location = { Left: 400, Top: 310 };
    rect.Width = 60;
    rect.Height = 30;
    const out = mergeTree(root, laid, parts, new Set([ELLIPSE, RECT]));
    const written = (out.Children as Record<string, unknown>[]).find((c) => c.UniqueId === RECT)!;
    expect(written.Location).toEqual({ Left: null, Top: null, Row: 5, Column: 3 });
    expect(written.Margin).toEqual({ Left: 16, Top: 10 });
    expect(written.ObjectAlignment).toEqual({ Horizontal: ALIGN_H.left, Vertical: ALIGN_V.top });
    expect([written.Width, written.Height]).toEqual([60, 30]);
    // And laying the written tree out again puts it exactly there.
    const again = layoutTree(out, PANEL).leaves.find((l) => l.uid === RECT)!;
    expect(again.box).toEqual({ left: 400, top: 310, width: 60, height: 30 });
  });

  it("moves a part dragged into another cell into that cell", () => {
    const { root, laid } = laidSimple();
    const parts = flat(laid);
    const rect = parts.find((p) => p.UniqueId === RECT)!;
    rect.Location = { Left: 10, Top: 5 };
    const out = mergeTree(root, laid, parts, new Set([ELLIPSE, RECT]));
    const again = layoutTree(out, PANEL).leaves.find((l) => l.uid === RECT)!;
    expect(again.box).toEqual({ left: 10, top: 5, width: 128, height: 60 });
    const written = (out.Children as Record<string, unknown>[]).find((c) => c.UniqueId === RECT)!;
    expect(written.Location).toMatchObject({ Row: 0, Column: 0 });
  });

  it("drops a deleted part and adds a new one to the root grid at its place", () => {
    const { root, laid } = laidSimple();
    const parts = flat(laid).filter((p) => p.UniqueId !== ELLIPSE);
    parts.push({ Type: "Rectangle", UniqueId: "new", Name: "Added", Location: { Left: 700, Top: 450 }, Width: 80, Height: 40 });
    const out = mergeTree(root, laid, parts, new Set([ELLIPSE, RECT]));
    const kids = out.Children as Record<string, unknown>[];
    expect(kids.map((k) => k.UniqueId)).toEqual([RECT, "new"]);
    const again = layoutTree(out, PANEL).leaves.find((l) => l.uid === "new")!;
    expect(again.box).toEqual({ left: 700, top: 450, width: 80, height: 40 });
    // The original tree is not touched.
    expect((root.Children as unknown[]).length).toBe(2);
  });
});

describe("a Grid-rooted project, end to end", () => {
  async function simpleEote() {
    const zip = await JSZip.loadAsync(
      await (async () => {
        // The demo project is the container; its one screen is swapped for Simple's.
        const fs = await import("node:fs");
        const path = await import("node:path");
        return fs.readFileSync(path.join(__dirname, "..", "..", "demo_project", "HMICopilot_Minimal.eote"));
      })(),
    );
    const name = Object.keys(zip.files).find((n) => /Screens[\\/][0-9a-f-]{36}[\\/]Screen\.dat$/i.test(n))!;
    const id = name.split(/[\\/]/)[1];
    const screen = simpleScreen();
    screen.UniqueId = id;
    zip.file(name, JSON.stringify(screen, null, 2));
    return { bytes: await zip.generateAsync({ type: "uint8array" }), name, id };
  }

  it("opens with its parts in the editor at their cells, not as an empty screen", async () => {
    const { bytes, id } = await simpleEote();
    const read = await readProject(bytes);
    const screen = read.screens.find((s) => s.UniqueId === id)!;
    expect(read.carried.screens).toBe(0);
    const rect = screen.Children[0].Children.find((p) => p.UniqueId === RECT)!;
    expect(rect.Location).toEqual({ Left: 384, Top: 300 });
  });

  it("exports an edit into the grid, with the root still a Grid", async () => {
    const { bytes, id, name } = await simpleEote();
    const read = await readProject(bytes);
    const screen = read.screens.find((s) => s.UniqueId === id)!;
    const rect = screen.Children[0].Children.find((p) => p.UniqueId === RECT)!;
    rect.Location = { Left: 400, Top: 310 };
    rect.Width = 60;
    rect.Height = 30;
    const out = await packageProject(
      { name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires } as Parameters<typeof packageProject>[0],
      undefined,
      read.preserved,
    );
    const written = JSON.parse(await (await JSZip.loadAsync(out)).file(name)!.async("string"));
    const root = written.Children[0];
    expect(root.Type).toBe("Grid");
    expect(root.Rows).toHaveLength(10);
    const back = root.Children.find((c: { UniqueId: string }) => c.UniqueId === RECT);
    expect(back.Location).toEqual({ Left: null, Top: null, Row: 5, Column: 3 });
    expect(back.Margin).toEqual({ Left: 16, Top: 10 });
    // The part nobody touched is exactly as the product wrote it.
    expect(root.Children.find((c: { UniqueId: string }) => c.UniqueId === ELLIPSE)).toEqual(simpleScreen().Children[0].Children[0]);
  });
});
