/** Regressions for the audit's remaining bugs (docs/audit/BUGS.md), one per id. */

import { describe, expect, it } from "vitest";
import { applyOps, type Op } from "@/core/ops";
import { runPipeline } from "@/lib/ai/pipeline";
import { DEMO_VARIABLES } from "@/lib/ote/demo-project";
import { lamp, rectangle, textBox } from "@/lib/ote/parts";
import { rootBox, type Part } from "@/lib/ote/schema";
import { requestFromBrief, EMPTY_BRIEF } from "@/lib/brief/brief";
import { clientIp } from "@/lib/server/rate-limit";
import { requireReader } from "@/lib/server/access";
import { placeSymbol } from "@/components/library/placeSymbol";
import { createProjectStore } from "@/store/project";
import type { GenerationEvent } from "@/types/events";

function withParts(parts: Part[]) {
  const store = createProjectStore();
  store.getState().hydrate({ name: "T", target: { Width: 800, Height: 600 }, variables: [], screens: [], alarms: [], bindings: [] } as never);
  const id = store.getState().addScreen("Main");
  for (const part of parts) store.getState().appendObject(id, part);
  return store;
}
const box = { left: 100, top: 100, width: 80, height: 40 };
const only = (store: ReturnType<typeof withParts>) => store.getState().screens[0].Children[0].Children[0] as never as Record<string, Record<string, unknown>>;

describe("S1-11 setColor and setText land where the part draws", () => {
  it("a lamp's colour is its on state, and the report says so", () => {
    const store = withParts([lamp("L", "OFF", "ON", box)]);
    const before = JSON.stringify(only(store).Off);
    const out = applyOps([{ op: "setColor", target: "L", color: "red" }] as Op[], store);
    expect(out.rejected).toEqual([]);
    expect(out.applied.join()).toMatch(/on-state fill/);
    expect(JSON.stringify(only(store).On)).toMatch(/"Fill":\{[^}]*"Color":\{"Value"/);
    expect(JSON.stringify(only(store).Off)).toBe(before);
  });

  it("a text box's colour is its text, and it has no border to colour", () => {
    const store = withParts([textBox("T", "Hello", box)]);
    expect(applyOps([{ op: "setColor", target: "T", color: "red" }] as Op[], store).applied.join()).toMatch(/text to red/);
    expect(applyOps([{ op: "setColor", target: "T", color: "red", colorRole: "border" }] as Op[], store).rejected[0].reason).toMatch(/draws no border/);
  });

  it("a rectangle still takes its fill", () => {
    const store = withParts([rectangle("R", box)]);
    expect(applyOps([{ op: "setColor", target: "R", color: "red" }] as Op[], store).applied.join()).toMatch(/fill to red/);
  });

  it("one wording reads on every face of a lamp", () => {
    const store = withParts([lamp("L", "OFF", "ON", box)]);
    applyOps([{ op: "setText", target: "L", text: "PUMP" }] as Op[], store);
    expect(only(store).Off.Text).toBe("PUMP");
    expect(only(store).On.Text).toBe("PUMP");
  });
});

describe("S2-14 the address a limit counts", () => {
  const ask = (headers: Record<string, string>) => new Request("http://x", { headers });
  it("is not what the client wrote first", () => {
    expect(clientIp(ask({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" }))).toBe("10.0.0.1");
  });
  it("is the platform's on Vercel", () => {
    process.env.VERCEL = "1";
    try {
      expect(clientIp(ask({ "x-forwarded-for": "6.6.6.6, 10.0.0.1", "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    } finally {
      delete process.env.VERCEL;
    }
  });
});

describe("S2-09 a signed-out caller", () => {
  it("is told to sign in whether the project exists or not", async () => {
    await expect(requireReader(null, "no-such-project", new Request("http://x"))).rejects.toMatchObject({ status: 401 });
  });
});

describe("S4-25 the brief's screens", () => {
  it("get built, the alarm screen among them", async () => {
    const brief = { ...EMPTY_BRIEF, plant: { name: "Water plant", purpose: "" }, units: [], screens: { overview: true, perUnitGroup: true, alarms: true } };
    const intent = requestFromBrief(brief as never);
    expect(intent).toMatch(/an alarm screen/);
    const screens: string[] = [];
    for await (const event of runPipeline({ intent, variables: DEMO_VARIABLES }) as AsyncIterable<GenerationEvent>) {
      if (event.type === "program") screens.push(event.program.name);
    }
    expect(screens).toContain("Alarms");
  });
});

describe("S5-09 a dropped symbol", () => {
  it("looks where it lands, and says when there is no room", () => {
    const symbol = { name: "Valve 1", Commands: "M", Points: "0,0" };
    const store = withParts([rectangle("Wall", { left: 0, top: 0, width: 400, height: 600 })]);
    const screen = store.getState().screens[0];
    const placed = placeSymbol(screen, symbol);
    expect(placed.ok).toBe(true);
    if (placed.ok) {
      expect(placed.part.Name).toBe("Sym_Valve1");
      expect(placed.part.Location.Left).toBeGreaterThanOrEqual(400);
    }
    const { width, height } = rootBox(screen.Children[0]);
    const grid = (size: number, most: number) => Array.from({ length: Math.ceil(most / size) }, (_, i) => i * size);
    const full = withParts(grid(100, width).flatMap((left) => grid(100, height).map((top) => lamp(`W${left}_${top}`, "A", "B", { left, top, width: 100, height: 100 }))));
    expect(placeSymbol(full.getState().screens[0], symbol).ok).toBe(false);
  });
});
