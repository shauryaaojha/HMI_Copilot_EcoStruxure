/**
 * The co-editing algebra: diff, apply, invert, validate, compact.
 *
 * Live co-editing rests on one promise - that applying the records `diff`
 * produced turns the old document into exactly the new one, on every client
 * and on the server - and on the records being safe to apply twice. These
 * tests hold that promise against hand-made edits on the demo fixture and,
 * more to the point, against what the real store actions actually do, since
 * those are what the client will be diffing.
 */

import { describe, expect, it } from "vitest";
import { freeze, produce, type Draft } from "immer";
import { demoAlarms, demoScreen, demoVariables } from "@/fixtures";
import { alarmKey } from "@/lib/ote/reader";
import type { Part, Screen } from "@/lib/ote/schema";
import { createProjectStore, DEFAULT_STANDARDS } from "@/store/project";
import {
  CollabApplyError,
  SYNCED_KEYS,
  alarmKeyOf,
  apply,
  applyChange,
  compact,
  diff,
  docOf,
  invert,
  validStoreChange,
} from "@/lib/collab/changes";
import type { Doc, StoreChange } from "@/lib/collab/types";

const parts = (screen: Screen) => screen.Children[0].Children;
const lamp = (name: string) => parts(demoScreen).find((p) => p.Name === name)!;

function baseDoc(): Doc {
  const ids = parts(demoScreen).map((p) => p.UniqueId);
  const handles: Record<string, string> = { [demoScreen.UniqueId]: "s1" };
  ids.forEach((id, i) => (handles[id] = `o${i + 2}`));
  const doc = docOf({
    name: "Pump station",
    target: { model: "HMIGTO6310", width: 1024, height: 768 },
    screens: [structuredClone(demoScreen)],
    variables: structuredClone(demoVariables),
    alarms: structuredClone(demoAlarms),
    bindings: [
      { tag: "PUMP1_RUN", targetId: lamp("Lamp_PUMP1_RUN").UniqueId, targetName: "Lamp_PUMP1_RUN", property: "Value" },
      { tag: "PUMP1_FLT", targetId: lamp("Lamp_PUMP1_FLT").UniqueId, targetName: "Lamp_PUMP1_FLT", property: "Value" },
      { tag: "PUMP2_RUN", targetId: lamp("Lamp_PUMP2_RUN").UniqueId, targetName: "Lamp_PUMP2_RUN", property: "Value" },
    ],
    objectMeta: { [ids[0]]: { origin: "generated", key: "banner" } },
    screenPlacement: {},
    handles,
    handleSeq: ids.length + 1,
    standards: DEFAULT_STANDARDS,
  });
  return freeze(doc, true);
}

const newPart = (from: Part, name: string): Part => ({ ...structuredClone(from), UniqueId: crypto.randomUUID(), Name: name });

function newScreen(name: string, children: Part[]): Screen {
  return {
    Type: "Screen",
    UniqueId: crypto.randomUUID(),
    Name: name,
    Children: [{ Type: "ViewBox", UniqueId: crypto.randomUUID(), Name: "ViewBox", Options: 108, Width: 1024, Height: 768, Children: children }],
  };
}

/** Everything a pair of documents has to satisfy. */
function expectRoundTrip(before: Doc, after: Doc): StoreChange[] {
  const ops = diff(before, after);
  const applied = apply(before, ops);
  expect(applied).toEqual(after);
  // Idempotent: a change that arrives twice does no harm.
  expect(apply(applied, ops)).toEqual(applied);
  // Undo as a change.
  expect(apply(applied, invert(before, ops))).toEqual(before);
  // The server accepts what the client produces, also after a JSON trip.
  for (const op of ops) expect(validStoreChange(JSON.parse(JSON.stringify(op)))).toBe(true);
  expect(apply(before, compact(ops))).toEqual(applied);
  return ops;
}

type Edit = [label: string, edit: (d: Draft<Doc>) => void];

const p = (d: Draft<Doc>, screen = 0) => d.screens[screen].Children[0].Children;

/** A second screen with two parts, fresh ids each time so edits can stack. */
const overview = () => newScreen("Overview", [newPart(lamp("Lamp_PUMP1_RUN"), "Ov_Lamp"), newPart(lamp("Title"), "Ov_Title")]);
const extraScreen = overview();

const edits: Edit[] = [
  ["move a part", (d) => { p(d)[5].Location.Left += 16; }],
  ["change a property", (d) => { p(d)[1].Name = "Heading"; (p(d)[0] as { Thickness?: number }).Thickness = 3; }],
  ["add a part", (d) => { p(d).splice(3, 0, newPart(lamp("Lamp_PUMP1_RUN"), "Lamp_NEW") as Draft<Part>); }],
  ["append a part", (d) => { p(d).push(newPart(lamp("Title"), "Footer") as Draft<Part>); }],
  ["delete a part", (d) => { p(d).splice(7, 1); }],
  ["restack parts", (d) => { const [front] = p(d).splice(0, 1); p(d).push(front); }],
  ["reverse the stack", (d) => { p(d).reverse(); }],
  ["rename a screen", (d) => { d.screens[0].Name = "Station"; }],
  ["resize the view", (d) => { d.screens[0].Children[0].Width = 1280; }],
  ["add a second screen with parts", (d) => { d.screens.push(overview() as Draft<Screen>); }],
  ["add a screen at the front", (d) => { d.screens.unshift(overview() as Draft<Screen>); }],
  ["remove a screen", (d) => { if (d.screens.length > 1) d.screens.splice(d.screens.length - 1, 1); }],
  ["add a variable", (d) => { d.variables.push({ Name: "NEW_TAG", DataType: "BOOL", Comments: "", DeviceAddress: "%M100" }); }],
  ["insert a variable", (d) => { d.variables.splice(1, 0, { Name: "MID_TAG", DataType: "INT", Comments: "", DeviceAddress: "" }); }],
  ["remove a variable", (d) => { d.variables.splice(0, 1); }],
  ["change a variable", (d) => { d.variables[1].Comments = "edited"; }],
  ["change an alarm", (d) => { d.alarms[0].Severity = 9; }],
  ["re-key an alarm", (d) => { d.alarms[1].Message = "Pump 2 tripped"; }],
  ["add a binding", (d) => { d.bindings.push({ tag: "FLOW", targetId: lamp("Num_Flow").UniqueId, targetName: "Num_Flow", property: "Value" }); }],
  ["replace a binding in place", (d) => { d.bindings[1].tag = "OTHER"; }],
  ["rebind the store's way", (d) => { const [b] = d.bindings.splice(0, 1); d.bindings.push({ ...b, tag: "REBOUND" }); }],
  ["remove a binding", (d) => { d.bindings.splice(2, 1); }],
  ["set objectMeta", (d) => { d.objectMeta[lamp("Lamp_PUMP1_RUN").UniqueId] = { locked: true }; }],
  ["remove objectMeta", (d) => { delete d.objectMeta[parts(demoScreen)[0].UniqueId]; }],
  ["set a handle", (d) => { d.handles!["x"] = "o99"; d.handleSeq = 99; }],
  ["set a handle below the sequence", (d) => { d.handles!["y"] = "o3"; }],
  ["place a screen", (d) => { d.screenPlacement[demoScreen.UniqueId] = { x: 10, y: 20 }; }],
  ["rename the project", (d) => { d.name = "Renamed"; }],
  ["set an optional field", (d) => { d.layout = "struct"; }],
  ["change standards", (d) => { d.standards.gridSize = 16; }],
];

describe("diff and apply on the demo fixture", () => {
  it("returns nothing for an unchanged doc", () => {
    const doc = baseDoc();
    expect(diff(doc, doc)).toEqual([]);
    expect(diff(doc, produce(doc, () => {}))).toEqual([]);
  });

  it("compares by reference before JSON", () => {
    const doc = baseDoc();
    const copy = { ...doc, screens: [...doc.screens] };
    const stringify = JSON.stringify;
    let calls = 0;
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      calls++;
      return stringify(...args);
    }) as typeof stringify;
    try {
      expect(diff(doc, copy)).toEqual([]);
    } finally {
      JSON.stringify = stringify;
    }
    expect(calls).toBe(0);
  });

  for (const [label, edit] of edits) {
    it(`round-trips: ${label}`, () => {
      const before = baseDoc();
      const after = produce(before, edit);
      const ops = expectRoundTrip(before, after);
      // "remove a screen" is a no-op on the one-screen base; it bites in the stacked runs.
      expect(ops.length > 0).toBe(after !== before);
    });
  }

  it("round-trips every edit at once", () => {
    const before = baseDoc();
    const after = produce(before, (d) => {
      for (const [, edit] of edits) edit(d);
    });
    expectRoundTrip(before, after);
  });

  it("round-trips edits applied one after another", () => {
    let doc = baseDoc();
    for (const [, edit] of edits) {
      const next = produce(doc, edit);
      expectRoundTrip(doc, next);
      doc = next;
    }
  });

  it("emits the minimal record for a move", () => {
    const before = baseDoc();
    const after = produce(before, (d) => { p(d)[5].Location.Left += 16; });
    const ops = diff(before, after);
    expect(ops).toEqual([{ kind: "setPart", screenId: demoScreen.UniqueId, part: parts(after.screens[0])[5], index: 5 }]);
  });

  it("removes a screen and moves its part to another", () => {
    const before = produce(baseDoc(), (d) => { d.screens.push(structuredClone(extraScreen) as Draft<Screen>); });
    const after = produce(before, (d) => {
      const moved = p(d, 1)[0];
      p(d, 0).splice(2, 0, moved);
      d.screens.splice(1, 1);
    });
    const ops = expectRoundTrip(before, after);
    expect(ops.map((op) => op.kind)).toEqual(["removeScreen", "setPart"]);
  });

  it("moves parts between screens in both directions", () => {
    const before = produce(baseDoc(), (d) => { d.screens.push(structuredClone(extraScreen) as Draft<Screen>); });
    const after = produce(before, (d) => {
      const [a] = p(d, 0).splice(4, 1);
      const [b] = p(d, 1).splice(1, 1);
      p(d, 1).unshift(a);
      p(d, 0).splice(2, 0, b);
    });
    const ops = expectRoundTrip(before, after);
    expect(ops.some((op) => op.kind === "removePart")).toBe(false);
  });

  it("moves a part onto a new screen without duplicating it", () => {
    const before = baseDoc();
    const after = produce(before, (d) => {
      const [a] = p(d, 0).splice(4, 1);
      const screen = structuredClone(extraScreen) as Draft<Screen>;
      screen.Children[0].Children.push(a);
      d.screens.push(screen);
    });
    expectRoundTrip(before, after);
  });

  it("reorders screens", () => {
    const before = produce(baseDoc(), (d) => {
      d.screens.push(structuredClone(extraScreen) as Draft<Screen>);
      d.screens.push(newScreen("Third", []) as Draft<Screen>);
    });
    const after = produce(before, (d) => { d.screens.reverse(); });
    const ops = expectRoundTrip(before, after);
    expect(ops.map((op) => op.kind)).toEqual(["reorderScreens"]);
  });

  it("agrees with the reader's alarmKey when there is a Trigger", () => {
    const alarm = { ...demoAlarms[0], Trigger: "Pump1_Fault" };
    expect(alarmKeyOf(alarm)).toBe(alarmKey(alarm));
    expect(alarmKeyOf(demoAlarms[0])).toBe("msg|Pump 1 fault|1|1");
  });

  it("picks the synced slice and fills missing maps", () => {
    const doc = docOf({ name: "x", screens: undefined, chat: [], selectedIds: ["a"] } as Record<string, unknown>);
    expect(doc.screens).toEqual([]);
    expect(doc.handles).toEqual({});
    expect("chat" in doc).toBe(false);
    expect("source" in doc).toBe(false);
    expect(Object.keys(doc).every((k) => (SYNCED_KEYS as readonly string[]).includes(k))).toBe(true);
  });
});

describe("apply semantics", () => {
  it("refuses a part onto a missing screen", () => {
    const op: StoreChange = { kind: "setPart", screenId: "nope", part: parts(demoScreen)[0] };
    expect(() => applyChange(baseDoc(), op)).toThrow(CollabApplyError);
    try {
      applyChange(baseDoc(), op);
    } catch (error) {
      expect((error as CollabApplyError).reason).toBe("screen-missing");
    }
  });

  it("moves a part between screens with setPart", () => {
    const doc = produce(baseDoc(), (d) => { d.screens.push(structuredClone(extraScreen) as Draft<Screen>); });
    const part = parts(doc.screens[0])[3];
    const next = applyChange(doc, { kind: "setPart", screenId: extraScreen.UniqueId, part, index: 0 });
    expect(parts(next.screens[0]).some((x) => x.UniqueId === part.UniqueId)).toBe(false);
    expect(parts(next.screens[1])[0].UniqueId).toBe(part.UniqueId);
    expect(applyChange(next, { kind: "setPart", screenId: extraScreen.UniqueId, part, index: 0 })).toEqual(next);
  });

  it("reorders stably and idempotently, ignoring unknown ids", () => {
    const doc = baseDoc();
    const ids = parts(doc.screens[0]).map((x) => x.UniqueId);
    const order = ["ghost", ids[3], ids[1]];
    const once = applyChange(doc, { kind: "reorderParts", screenId: demoScreen.UniqueId, order });
    const got = parts(once.screens[0]).map((x) => x.UniqueId);
    expect(got[1]).toBe(ids[3]);
    expect(got[3]).toBe(ids[1]);
    expect(got.filter((_, i) => i !== 1 && i !== 3)).toEqual(ids.filter((_, i) => i !== 1 && i !== 3));
    expect(applyChange(once, { kind: "reorderParts", screenId: demoScreen.UniqueId, order })).toEqual(once);
    expect(applyChange(doc, { kind: "reorderParts", screenId: "missing", order })).toBe(doc);
  });

  it("treats removes of absent things as no-ops", () => {
    const doc = baseDoc();
    const ops: StoreChange[] = [
      { kind: "removePart", screenId: demoScreen.UniqueId, partId: "ghost" },
      { kind: "removeScreen", screenId: "ghost" },
      { kind: "removeVariable", name: "ghost" },
      { kind: "removeAlarm", key: "ghost" },
      { kind: "removeBinding", targetId: "ghost", property: "Value" },
      { kind: "removeEntry", field: "objectMeta", key: "ghost" },
      { kind: "renameScreen", screenId: "ghost", name: "x" },
    ];
    expect(apply(doc, ops)).toBe(doc);
  });

  it("raises handleSeq when a handle is set, and deletes a field set to undefined", () => {
    const doc = baseDoc();
    const next = applyChange(doc, { kind: "setEntry", field: "handles", key: "z", value: "o500" });
    expect(next.handleSeq).toBe(500);
    expect(applyChange(next, { kind: "setEntry", field: "handles", key: "w", value: "s3" }).handleSeq).toBe(500);
    const cleared = applyChange(applyChange(doc, { kind: "setField", field: "source", value: "imp" }), {
      kind: "setField",
      field: "source",
      value: undefined,
    });
    expect("source" in cleared).toBe(false);
  });

  it("does not let a later mutation of the op change the doc", () => {
    const doc = baseDoc();
    const part = newPart(lamp("Title"), "Fresh");
    const next = applyChange(doc, { kind: "setPart", screenId: demoScreen.UniqueId, part });
    const snapshot = JSON.stringify(next);
    try {
      part.Name = "Mutated";
    } catch {
      /* frozen: also fine */
    }
    expect(JSON.stringify(next)).toBe(snapshot);
  });
});

describe("the real store", () => {
  function hydrated() {
    const store = createProjectStore();
    const extra = structuredClone(extraScreen);
    store.getState().hydrate({
      id: "collab",
      name: "Collab",
      screens: [structuredClone(demoScreen), extra],
      activeScreenId: demoScreen.UniqueId,
      variables: structuredClone(demoVariables),
      alarms: structuredClone(demoAlarms),
      bindings: [],
    });
    return store;
  }

  it("round-trips what the actions do, one by one and all at once", () => {
    const store = hydrated();
    const s = () => store.getState();
    const ids = () => parts(s().screens[0]).map((x) => x.UniqueId);
    const start = docOf(s());
    const actions: [string, () => void][] = [
      ["nudge", () => s().nudge([ids()[2], ids()[3]], 8, -4)],
      ["setBox", () => s().setBox(ids()[5], { left: 10, top: 20, width: 30, height: 40 })],
      ["setBinding", () => s().setBinding(ids()[5], "Value", "PUMP1_RUN")],
      ["setBinding again", () => s().setBinding(ids()[6], "Value", "PUMP1_FLT")],
      ["rebind", () => s().setBinding(ids()[5], "Value", "PUMP2_RUN")],
      ["removeObjects", () => s().removeObjects([ids()[6]])],
      ["restackObjects", () => s().restackObjects([ids()[0]], "front")],
      ["restack backward", () => s().restackObjects([ids()[4]], "backward")],
      ["addScreen", () => void s().addScreen("Trends")],
      ["renameScreen", () => s().renameScreen(demoScreen.UniqueId, "Station")],
      ["reorderScreens", () => s().reorderScreens(0, 2)],
      ["setActiveScreen", () => s().setActiveScreen(demoScreen.UniqueId)],
      ["setMeta", () => s().setMeta([ids()[1]], { locked: true })],
      ["group", () => s().group([ids()[2], ids()[3]])],
      ["duplicateObjects", () => s().duplicateObjects([ids()[2], ids()[3]])],
      ["appendObject", () => s().appendObject(extraScreen.UniqueId, newPart(lamp("Lamp_PUMP2_RUN"), "Ov_Lamp2"))],
      ["placeScreen", () => s().placeScreen(extraScreen.UniqueId, { x: 1200, y: 0 })],
      ["removeScreen", () => s().removeScreen(extraScreen.UniqueId)],
      ["rename project", () => s().rename("Collab 2")],
      ["undo", () => s().undo()],
      ["redo", () => s().redo()],
    ];
    for (const [label, act] of actions) {
      const before = docOf(s());
      act();
      const after = docOf(s());
      try {
        expectRoundTrip(before, after);
      } catch (error) {
        throw new Error(`after ${label}: ${(error as Error).message}`);
      }
    }
    expectRoundTrip(start, docOf(s()));
  });
});

describe("validStoreChange", () => {
  it("rejects malformed records", () => {
    const bad: unknown[] = [
      null,
      "setPart",
      { kind: "explode" },
      { kind: "setPart", screenId: "s", part: { Name: "no id" } },
      { kind: "setPart", part: { UniqueId: "p", Type: "Lamp" } },
      { kind: "setPart", screenId: "s", part: { UniqueId: "p", Type: "Lamp" }, index: -1 },
      { kind: "removePart", screenId: "s" },
      { kind: "reorderParts", screenId: "s", order: "a,b" },
      { kind: "reorderParts", screenId: "s", order: ["a", 2] },
      { kind: "reorderScreens" },
      { kind: "addScreen", screen: { UniqueId: "s", Type: "Screen", Name: "x" } },
      { kind: "renameScreen", screenId: "s" },
      { kind: "setVariable", variable: { DataType: "BOOL" } },
      { kind: "setAlarm", key: "wrong", alarm: demoAlarms[0] },
      { kind: "setBinding", binding: { targetId: "t", tag: "x" } },
      { kind: "removeBinding", targetId: "t" },
      { kind: "setEntry", field: "chat", key: "k", value: 1 },
      { kind: "removeEntry", field: "objectMeta" },
      { kind: "setField", field: "versions", value: [] },
    ];
    for (const value of bad) expect(validStoreChange(value), JSON.stringify(value)).toBe(false);
  });

  it("accepts well-formed records", () => {
    expect(validStoreChange({ kind: "setAlarm", key: alarmKeyOf(demoAlarms[0]), alarm: demoAlarms[0] })).toBe(true);
    expect(validStoreChange({ kind: "setField", field: "source" })).toBe(true);
    expect(validStoreChange({ kind: "reorderScreens", order: [] })).toBe(true);
  });
});

describe("compact", () => {
  it("drops superseded records and never changes the result", () => {
    const doc = baseDoc();
    const sid = demoScreen.UniqueId;
    const part = parts(doc.screens[0])[4];
    const at = (left: number): Part => ({ ...part, Location: { ...part.Location, Left: left } }) as Part;
    const fresh = newPart(lamp("Title"), "Fresh");
    const freshAt = (left: number): Part => ({ ...fresh, Location: { ...fresh.Location, Left: left } }) as Part;
    const variable = { Name: "V", DataType: "BOOL" as const, Comments: "", DeviceAddress: "" };
    const sequences: StoreChange[][] = [
      [1, 2, 3, 4].map((n) => ({ kind: "setPart", screenId: sid, part: at(n), index: 4 })),
      [
        { kind: "setPart", screenId: sid, part: freshAt(1), index: 2 },
        { kind: "setPart", screenId: sid, part: freshAt(2), index: 9 },
      ],
      [
        { kind: "setPart", screenId: sid, part: freshAt(1), index: 2 },
        { kind: "removePart", screenId: sid, partId: parts(doc.screens[0])[0].UniqueId },
        { kind: "setPart", screenId: sid, part: freshAt(2), index: 2 },
      ],
      [
        { kind: "setPart", screenId: sid, part: freshAt(1), index: 2 },
        { kind: "setField", field: "name", value: "A" },
        { kind: "setField", field: "name", value: "B" },
        { kind: "setPart", screenId: sid, part: freshAt(2), index: 2 },
      ],
      [
        { kind: "setEntry", field: "objectMeta", key: "k", value: { locked: true } },
        { kind: "setEntry", field: "objectMeta", key: "k", value: { hidden: true } },
        { kind: "setEntry", field: "handles", key: "h", value: "o900" },
        { kind: "setEntry", field: "handles", key: "h", value: "o2" },
        { kind: "setField", field: "handleSeq", value: 4 },
        { kind: "setEntry", field: "handles", key: "h2", value: "o50" },
      ],
      [
        { kind: "setEntry", field: "screenPlacement", key: "k", value: { x: 1, y: 1 } },
        { kind: "removeEntry", field: "screenPlacement", key: "k" },
      ],
      [
        { kind: "setVariable", variable: { ...variable, Comments: "1" }, index: 0 },
        { kind: "setVariable", variable: { ...variable, Comments: "2" }, index: 0 },
        { kind: "removeVariable", name: demoVariables[0].Name },
        { kind: "setVariable", variable: { ...variable, Comments: "3" }, index: 0 },
      ],
      [
        { kind: "setBinding", binding: { tag: "A", targetId: "t", targetName: "t", property: "Value" }, index: 1 },
        { kind: "setBinding", binding: { tag: "B", targetId: "t", targetName: "t", property: "Value" }, index: 1 },
        { kind: "setBinding", binding: { tag: "C", targetId: "t", targetName: "t", property: "Value" }, index: 0 },
      ],
      edits.flatMap(([, edit]) => {
        const after = produce(doc, edit);
        return diff(doc, after);
      }),
    ];
    for (const ops of sequences) {
      const short = compact(ops);
      expect(short.length).toBeLessThanOrEqual(ops.length);
      expect(apply(doc, short)).toEqual(apply(doc, ops));
    }
    expect(compact(sequences[0])).toHaveLength(1);
  });
});
