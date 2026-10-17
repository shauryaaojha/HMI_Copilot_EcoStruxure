/**
 * Overlaps found and moved clear by the layout engine (lib/ote/tidy.ts).
 *
 * The session that found this: "fix the overlapping" answered with an
 * alignObjects op on guessed handles, refused as "None of those objects
 * exist, so there was nothing to align".
 */

import { describe, expect, it } from "vitest";
import { overlapsOn, planTidy } from "@/lib/ote/tidy";
import { applyOps } from "@/lib/ai/applier";
import { coerceTurn, type Op } from "@/lib/ai/ops";
import { digestOf, volatileContext } from "@/lib/ai/converse";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { layoutApplication } from "@/lib/ote/layout";
import type { Part, Screen, Variable } from "@/lib/ote/schema";
import { createProjectStore } from "@/store/project";

const PANEL = { width: 1024, height: 600 };
let n = 0;
const rect = (Name: string, Left: number, Top: number, Width: number, Height: number, Type = "Rectangle"): Part =>
  ({ Type, UniqueId: `id${++n}`, Name, Location: { Left, Top }, Width, Height }) as unknown as Part;

const apply = (parts: Part[], moves: { ids: string[]; dx: number; dy: number }[]) => {
  const out = parts.map((p) => structuredClone(p));
  for (const m of moves) for (const p of out) if (m.ids.includes(p.UniqueId)) { p.Location.Left += m.dx; p.Location.Top += m.dy; }
  return out;
};

describe("overlapsOn", () => {
  it("finds two shapes sharing pixels, and names the smaller as the one to move", () => {
    const big = rect("CardA", 40, 120, 300, 160);
    const small = rect("Lbl", 300, 200, 120, 30, "TextBox");
    const [o] = overlapsOn([big, small]);
    expect(o.mover.name).toBe("Lbl");
    expect(o.other.name).toBe("CardA");
  });

  it("does not call a label on a card an overlap, nor the frame, nor a touch", () => {
    const card = rect("CardA", 40, 120, 300, 160);
    expect(overlapsOn([card, rect("OnIt", 60, 140, 100, 20, "TextBox")])).toEqual([]);
    expect(overlapsOn([card, rect("Ground_S", 0, 0, 1024, 600), rect("Hdr_S", 0, 0, 1024, 50)])).toEqual([]);
    expect(overlapsOn([card, rect("Next", 341, 120, 100, 50)])).toEqual([]);
    expect(overlapsOn([card, rect("Touch", 339, 120, 100, 50)])).toEqual([]);
  });

  it("treats a faceplate as one object", () => {
    const card = rect("CardB", 40, 120, 200, 120);
    const lamp = rect("CardB_RUN", 220, 130, 40, 20, "Lamp"); // pokes out of its own card
    const group = (id: string) => (id === card.UniqueId || id === lamp.UniqueId ? "g1" : undefined);
    expect(overlapsOn([card, lamp], group)).toEqual([]);
  });
});

describe("planTidy", () => {
  it("moves the smaller of two overlapping shapes clear, and nothing overlaps after", () => {
    const parts = [rect("CardA", 40, 120, 300, 160), rect("CardB", 200, 180, 300, 160)];
    const plan = planTidy(parts, PANEL);
    expect(plan.moves).toHaveLength(1);
    expect(overlapsOn(apply(parts, plan.moves))).toEqual([]);
  });

  it("moves a faceplate whole, every part by the same amount", () => {
    const card = rect("CardB", 200, 180, 260, 140);
    const lamp = rect("CardB_RUN", 220, 200, 60, 24, "Lamp");
    const value = rect("CardB_Val", 300, 240, 100, 24, "NumericDisplay");
    const parts = [rect("CardA", 40, 120, 300, 160), card, lamp, value];
    const g = new Set([card.UniqueId, lamp.UniqueId, value.UniqueId]);
    const plan = planTidy(parts, PANEL, (id) => (g.has(id) ? "g" : undefined));
    expect(plan.moves).toHaveLength(1);
    expect([...plan.moves[0].ids].sort()).toEqual([...g].sort());
    expect(overlapsOn(apply(parts, plan.moves), (id) => (g.has(id) ? "g" : undefined))).toEqual([]);
  });

  it("gives a lamp back to its own card when two equal cards sit on top of each other", () => {
    // Crusher 201 pushed onto Crusher 202, live: 202's lamp went back with 201.
    const c1 = rect("Card_GRD201", 200, 120, 250, 125);
    const c2 = rect("Card_GRD202", 270, 120, 250, 125);
    const l1 = rect("Lamp_GRD201_RUN", 210, 150, 80, 30, "Lamp");
    const l2 = rect("Lamp_GRD202_RUN", 280, 150, 80, 30, "Lamp");
    const plan = planTidy([c1, l1, c2, l2], PANEL);
    expect(plan.moves).toHaveLength(1);
    const ids = [...plan.moves[0].ids].sort();
    expect([[c1.UniqueId, l1.UniqueId].sort(), [c2.UniqueId, l2.UniqueId].sort()]).toContainEqual(ids);
  });

  it("says which object had nowhere to go on a full screen", () => {
    const parts = [rect("Wall", 0, 0, 1024, 600, "TrendGraph"), rect("Box", 100, 100, 1000, 500, "TrendGraph")];
    const plan = planTidy(parts, PANEL);
    expect(plan.stuck.length).toBeGreaterThan(0);
  });
});

describe("tidyLayout, from the conversation", () => {
  const tag = (Name: string, DataType: Variable["DataType"] = "BOOL"): Variable => ({ Name, DataType, Comments: "", DeviceAddress: "" });
  const variables = [101, 102, 103, 104, 105, 106, 107].flatMap((i) => [tag(`PMP_${i}_RUN`), tag(`PMP_${i}_FLT`), tag(`FT_${i}_PV`, "REAL")]);

  function seeded(push = true) {
    const equipment = inferEquipment(variables);
    const built = layoutApplication(fallbackPlan("plant", equipment).screens, equipment, PANEL);
    const screens: Screen[] = built.map((b) => b.screen);
    const store = createProjectStore();
    store.getState().hydrate({ id: "t", name: "T", target: { model: "HMIST6500AWADI", width: 1024, height: 600 }, screens, activeScreenId: screens[1].UniqueId, variables });
    // Faceplates are composites, as the pipeline registers them.
    for (const c of built.flatMap((b) => b.composites)) store.getState().registerComposite(c);
    // Push one faceplate onto its neighbour, the way a hand edit does.
    if (push) store.getState().nudge(built[1].composites[0].partIds, 120, 20);
    return store;
  }

  it("lists the active screen's overlaps for the model, by handle", () => {
    const store = seeded();
    const st = store.getState();
    const context = volatileContext(digestOf({ ...st, selectedIds: [] } as never));
    expect(context).toMatch(/Overlaps on it:\n\S+ \S+ overlaps \S+ \S+ by \d+x\d+px/);
  });

  it("moves a faceplate whole when its card is moved", () => {
    const store = seeded();
    const s = store.getState();
    const view = s.screens[1].Children[0].Children;
    const group = s.objectMeta[view.find((p) => s.objectMeta[p.UniqueId]?.groupId)!.UniqueId].groupId!;
    const members = view.filter((p) => s.objectMeta[p.UniqueId]?.groupId === group);
    const before = new Map(members.map((p) => [p.UniqueId, { ...p.Location }]));
    const card = members.find((p) => p.Type === "Rectangle") ?? members[0];
    const outcome = applyOps([{ op: "moveObject", target: card.Name, left: card.Location.Left + 40, top: card.Location.Top } as Op], store);
    expect(outcome.rejected).toEqual([]);
    const after = store.getState().screens[1].Children[0].Children;
    for (const m of members) {
      const now = after.find((p) => p.UniqueId === m.UniqueId)!.Location;
      expect(now.Left - before.get(m.UniqueId)!.Left, m.Name).toBe(40);
      expect(now.Top, m.Name).toBe(before.get(m.UniqueId)!.Top);
    }
  });

  it("moves the card with everything drawn on it, as a generated faceplate is built", () => {
    // The card is not in the composite of the lamps on it: moving it alone
    // left the lamps and readings behind (the grinder faceplate, live).
    const store = seeded(false);
    const s = store.getState();
    const view = s.screens[1].Children[0].Children;
    const card = view.find((p) => p.Type === "Rectangle" && /^Card_/.test(p.Name))!;
    const inside = view.filter(
      (p) => p !== card && p.Location.Left >= card.Location.Left && p.Location.Top >= card.Location.Top &&
        p.Location.Left + (p.Width ?? 0) <= card.Location.Left + (card.Width ?? 0) && p.Location.Top + (p.Height ?? 0) <= card.Location.Top + (card.Height ?? 0),
    );
    expect(inside.length).toBeGreaterThan(2);
    const before = new Map([card, ...inside].map((p) => [p.UniqueId, p.Location.Left]));
    applyOps([{ op: "moveObject", target: card.Name, left: card.Location.Left + 16, top: card.Location.Top } as Op], store);
    const after = store.getState().screens[1].Children[0].Children;
    for (const p of [card, ...inside]) expect(after.find((q) => q.UniqueId === p.UniqueId)!.Location.Left - before.get(p.UniqueId)!, p.Name).toBe(16);
  });

  it("moves by a distance when the engineer gives one, even onto a neighbour", () => {
    const store = seeded(false);
    const s = store.getState();
    const card = s.screens[1].Children[0].Children.find((p) => p.Type === "Rectangle" && /^Card_/.test(p.Name))!;
    const left = card.Location.Left;
    applyOps([{ op: "moveObject", target: card.Name, dx: 180 } as Op], store);
    const st = store.getState();
    expect(st.screens[1].Children[0].Children.find((p) => p.UniqueId === card.UniqueId)!.Location.Left).toBe(left + 180);
    // Now it overlaps the next faceplate, and tidyLayout clears it.
    expect(overlapsOn(st.screens[1].Children[0].Children, (id) => st.objectMeta[id]?.groupId).length).toBeGreaterThan(0);
    applyOps([{ op: "tidyLayout" } as Op], store);
    const done = store.getState();
    expect(overlapsOn(done.screens[1].Children[0].Children, (id) => done.objectMeta[id]?.groupId)).toEqual([]);
  });

  it("aligns to the side the note names when mode is left out, and never stacks them sideways", () => {
    const store = seeded(false);
    const view = () => store.getState().screens[1].Children[0].Children;
    const lamps = view().filter((p) => p.Type === "Lamp");
    expect(lamps.length).toBeGreaterThan(2);
    const lefts = lamps.map((l) => l.Location.Left);
    const outcome = applyOps([{ op: "alignObjects", select: "Lamp", note: "Aligned all lamps to the top" } as Op], store);
    expect(outcome.rejected).toEqual([]);
    const after = view().filter((p) => p.Type === "Lamp");
    expect(after.map((l) => l.Location.Left)).toEqual(lefts);
    expect(new Set(after.map((l) => l.Location.Top)).size).toBe(1);
  });

  it("asks which way when neither mode nor note says", () => {
    const store = seeded(false);
    const outcome = applyOps([{ op: "alignObjects", select: "Lamp", note: "lined them up" } as Op], store);
    expect(outcome.rejected[0].reason).toMatch(/Say which way to align/);
  });

  it("moves what overlaps clear on every screen it is asked for", () => {
    const store = seeded();
    const turn = coerceTurn({ mode: "edit", reply: "Tidied.", ops: [{ op: "tidyLayout", screens: ["all"], note: "cleared overlaps" }] })!;
    const outcome = applyOps(turn.ops as Op[], store);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.applied.join(" ")).toMatch(/moved \d+ clear/);
    const s = store.getState();
    for (const screen of s.screens) {
      const left = overlapsOn(screen.Children[0].Children, (id) => s.objectMeta[id]?.groupId);
      expect(left, screen.Name).toEqual([]);
    }
  });
});
