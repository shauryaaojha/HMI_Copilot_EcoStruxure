/**
 * S5-01: on a screen laid out by containers (every screen OTE creates is rooted
 * in a Grid), a change of paint order made in the editor (Layers drag, "Bring to
 * front", "]") is lost on export. LayersPanel.tsx:6-9 says the list "is the
 * z-order ... it changes the file"; mergeTree (lib/ote/containers.ts:363-381)
 * rebuilds each container's children in the ORIGINAL order and ignores the
 * order of the editor's flat list.
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";
import { restack } from "@/store/edits";

const ELLIPSE = "ccd5f1f6-b89d-4059-b663-3250cd28f325";
const RECT = "0f86a856-557c-463e-a1bc-5fe0ef7530fc";

async function gridEote() {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, "..", "..", "demo_project", "HMICopilot_Minimal.eote")));
  const name = Object.keys(zip.files).find((n) => /Screens[\\/][0-9a-f-]{36}[\\/]Screen\.dat$/i.test(n))!;
  const id = name.split(/[\\/]/)[1];
  zip.file(name, JSON.stringify({
    Type: "Screen", UniqueId: id, Name: "Screen1", NavigationSwitch: { Label: "Screen1" },
    Children: [{
      Type: "Grid", UniqueId: "7251104b-86bb-4bff-8915-bdf2b229143b", Name: "Grid", Options: 104,
      Rows: Array.from({ length: 10 }, () => ({})), Columns: Array.from({ length: 8 }, () => ({})),
      Children: [
        { Type: "Ellipse", UniqueId: ELLIPSE, Name: "Ellipse1", Location: { Left: null, Top: null, Row: 2, Column: 2 } },
        { Type: "Rectangle", UniqueId: RECT, Name: "Rectangle1", Location: { Left: null, Top: null, Row: 5, Column: 3 } },
      ],
    }],
  }));
  return { bytes: await zip.generateAsync({ type: "uint8array" }), name, id };
}

describe("S5-01 paint order on a Grid-rooted screen", () => {
  it("survives export after the engineer brings the ellipse to the front", async () => {
    const { bytes, name, id } = await gridEote();
    const read = await readProject(bytes);
    const screen = read.screens.find((s) => s.UniqueId === id)!;
    // What the store's restackObjects does for "Bring to front" (store/slices/objects.ts:220-226).
    screen.Children[0].Children = restack(screen.Children[0].Children, [ELLIPSE], "front");
    expect(screen.Children[0].Children.map((p) => p.UniqueId)).toEqual([RECT, ELLIPSE]);

    const out = await packageProject(
      { name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires } as Parameters<typeof packageProject>[0],
      undefined,
      read.preserved,
    );
    const written = JSON.parse(await (await JSZip.loadAsync(out)).file(name)!.async("string"));
    const order = (written.Children[0].Children as { UniqueId: string }[]).map((c) => c.UniqueId);
    expect(order, "the exported Grid paints the ellipse last (in front)").toEqual([RECT, ELLIPSE]);
  });
});
