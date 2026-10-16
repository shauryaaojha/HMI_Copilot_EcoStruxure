/**
 * Pictures in a project: a ClipArt names its PNG by SHA-1, the bytes live at
 * Resources\<sha1>.png, and Resources.dat lists one entry per use. Shapes from
 * the product's own Demo 1.eote. lib/ote/resources.ts, lib/ote/cliparts.ts.
 */

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { addPictures, picturesUsed } from "@/lib/ote/resources";
import { CLIPART_DIR, clipartFor, cliparts, pngSize, sha1 } from "@/lib/ote/cliparts";
import { Part, type Screen } from "@/lib/ote/schema";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30, 8, 6, 0, 0, 0]);
const SHA = sha1(PNG);
const clip = (id: number) => ({
  Type: "ClipArt",
  UniqueId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  Name: `Clip${id}`,
  ImagePath: { Value: SHA, DisplayValue: "C:\\lib\\Pump.png" },
  Location: { Left: 10, Top: 10 },
  Width: 40,
  Height: 30,
});
const screenWith = (...parts: unknown[]) =>
  ({ Type: "Screen", UniqueId: "00000000-0000-4000-8000-000000000999", Name: "S", Children: [{ Type: "ViewBox", UniqueId: "00000000-0000-4000-8000-000000000998", Name: "V", Width: 100, Height: 100, Children: parts }] }) as unknown as Screen;

describe("pictures", () => {
  it("parse as parts", () => {
    expect(Part.safeParse(clip(1)).success).toBe(true);
  });

  it("read a PNG's size from its header", () => {
    expect(pngSize(PNG)).toEqual({ width: 40, height: 30 });
    expect(pngSize(new Uint8Array(4))).toBeNull();
  });

  it("are counted per use", () => {
    expect(picturesUsed([screenWith(clip(1), clip(2))])).toEqual(new Map([[SHA, 2]]));
  });

  it("bring their bytes and one Resources.dat entry per use", () => {
    const entries = new Map<string, Uint8Array>();
    const missing = addPictures(entries, [screenWith(clip(1), clip(2))], (sha) => (sha === SHA ? { bytes: PNG, path: "C:\\lib\\Pump.png" } : undefined));
    expect(missing).toEqual([]);
    expect(entries.get(`Resources\\${SHA}.png`)).toBe(PNG);
    const dat = JSON.parse(new TextDecoder().decode(entries.get("Resources.dat")));
    expect(dat[SHA]).toEqual([
      { Type: 0, Value: SHA, DisplayValue: "C:\\lib\\Pump.png" },
      { Type: 0, Value: SHA, DisplayValue: "C:\\lib\\Pump.png" },
    ]);
  });

  it("leave a project that already holds them byte for byte", () => {
    const dat = new TextEncoder().encode(JSON.stringify({ [SHA]: [{ Type: 0, Value: SHA }] }));
    const entries = new Map<string, Uint8Array>([[`Resources\\${SHA}.png`, PNG], ["Resources.dat", dat]]);
    addPictures(entries, [screenWith(clip(1), clip(2))], () => undefined);
    expect(entries.get("Resources.dat")).toBe(dat);
  });

  it("report a picture nobody can supply instead of writing a hole", () => {
    expect(addPictures(new Map(), [screenWith(clip(1))], () => undefined)).toEqual([SHA]);
  });
});

const installed = fs.existsSync(CLIPART_DIR) ? describe : describe.skip;
installed("the installed clipart library", () => {
  it("has the product's 200 pictures, named by content", async () => {
    const { list, bytes } = await cliparts();
    expect(list.length).toBe(200);
    for (const c of list.slice(0, 5)) expect(sha1(bytes.get(c.sha1)!)).toBe(c.sha1);
    // The same valve the product's own Demo 1.eote references by this hash.
    expect(list.some((c) => c.sha1 === "ab5bade85a43646033592c52e8d4a44356534f80")).toBe(true);
    expect(clipartFor(list, "centrifugal pump")?.group).toBe("Pumps");
  }, 30_000);
});
