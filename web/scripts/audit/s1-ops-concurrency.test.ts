/**
 * Audit 2026-11, stream S1: core/ops and the change log under concurrent edits.
 * Each `it` proves one bug in docs/audit/BUGS.md and FAILS on 5fd701d.
 *
 * The "server" here is `apply` from lib/collab/changes, which is exactly what
 * lib/server/repo-live.ts:122 runs for every accepted change, in arrival order;
 * the "clients" are real project stores whose edits go through applyOps and are
 * turned into change records by `diff`, as lib/collab/sync.ts does.
 *
 *   cd web && MONGODB_URI= npx vitest run --config scripts/audit/vitest.config.mts scripts/audit/s1-ops-concurrency.test.ts
 */
import { describe, expect, it } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { applyOps, commit, dryRun, handleOf, type Op } from "@/core/ops";
import { apply, diff, docOf } from "@/lib/collab/changes";
import type { Doc } from "@/lib/collab/types";
import type { Screen } from "@/lib/ote/schema";
import { createProjectStore, DEFAULT_STANDARDS } from "@/store/project";

function storeOf(screens: Screen[]) {
  const store = createProjectStore();
  store.getState().hydrate({
    id: "p",
    name: "Audit",
    target: { model: "HMIST6500AWADI", width: 1024, height: 600 },
    screens: structuredClone(screens),
    activeScreenId: screens[0].UniqueId,
    variables: structuredClone(demoVariables),
    alarms: [],
    bindings: [],
    objectMeta: {},
    screenPlacement: {},
    standards: DEFAULT_STANDARDS,
    versions: [],
    chat: [],
    foreign: {},
  } as never);
  return store;
}
const partsOf = (s: Screen) => s.Children[0].Children;
const first = () => partsOf(demoScreen)[0];
const second = () => partsOf(demoScreen)[1];

/** A second client: the same document, its own store. */
function clientFrom(doc: Doc) {
  const store = createProjectStore();
  store.getState().hydrate({ ...structuredClone(doc), id: "p", activeScreenId: doc.screens[0].UniqueId, versions: [], chat: [] } as never);
  return store;
}

describe("S1 ops under concurrent edits", () => {
  it("S1-06 accepting an AI proposal does not undo an edit made after it was proposed", () => {
    const live = storeOf([demoScreen]);
    const s = live.getState();
    // The Copilot proposes deleting the first part (a delete is always a proposal: useChat.ts:390).
    const run = dryRun([{ op: "deleteObject", target: handleOf(s, first().UniqueId) } as Op], live);
    // While the proposal waits, the engineer drags the second part 40 px right.
    const moved = { left: second().Location.Left + 40, top: second().Location.Top, width: second().Width ?? 0, height: second().Height ?? 0 };
    live.getState().setBox(second().UniqueId, moved);
    // Then clicks Accept: useChat.ts:473 commits the stored run.
    commit(run, "Accepted proposal", live);
    const now = partsOf(live.getState().screens[0]).find((p) => p.UniqueId === second().UniqueId)!;
    expect(now.Location.Left, "the engineer's drag after the proposal").toBe(moved.left);
  });

  it("S1-07 two people adding a part at the same time do not get the same handle", () => {
    const base = docOf(storeOf([demoScreen]).getState());
    const a = clientFrom(base);
    const b = clientFrom(base);
    applyOps([{ op: "addObject", type: "TextBox", text: "from A", left: 10, top: 10 } as Op], a);
    applyOps([{ op: "addObject", type: "TextBox", text: "from B", left: 10, top: 300 } as Op], b);
    const fromA = diff(base, docOf(a.getState()));
    const fromB = diff(base, docOf(b.getState()));
    // The server folds both, in arrival order, onto the head (repo-live.ts:122).
    const head = apply(apply(base, fromA), fromB);
    const handles = Object.values(head.handles as Record<string, string>);
    const twice = handles.filter((h, i) => handles.indexOf(h) !== i);
    expect(twice, `handles held by two objects after both edits landed`).toEqual([]);
  });

  it("S1-08 two people editing different properties of one part both keep their edit", () => {
    const base = docOf(storeOf([demoScreen]).getState());
    const a = clientFrom(base);
    const b = clientFrom(base);
    const textBox = partsOf(demoScreen).find((p) => p.Type === "TextBox")!;
    applyOps([{ op: "setText", target: handleOf(a.getState(), textBox.UniqueId), text: "RENAMED" } as Op], a);
    applyOps([{ op: "moveObject", target: handleOf(b.getState(), textBox.UniqueId), dx: 24, dy: 0 } as Op], b);
    // Both changes are made against the same base revision; the server applies them in order
    // and never compares a change's base with the head (repo-live.ts:99-135).
    const head = apply(apply(base, diff(base, docOf(a.getState()))), diff(base, docOf(b.getState())));
    const got = partsOf(head.screens[0]).find((p) => p.UniqueId === textBox.UniqueId) as unknown as { Text: string; Location: { Left: number } };
    expect(got.Location.Left, "B's move").toBe(textBox.Location.Left + 24);
    expect(got.Text, "A's text, overwritten by B's whole-part setPart").toBe("RENAMED");
  });

  it("S1-09 an op that names a screen edits the object on that screen, not a namesake elsewhere", () => {
    const other = structuredClone(demoScreen);
    other.UniqueId = "7b7b7b7b-0000-4000-8000-000000000001";
    other.Name = "Second";
    other.Children[0].UniqueId = "7b7b7b7b-0000-4000-8000-000000000002";
    partsOf(other).forEach((p, i) => (p.UniqueId = `7b7b7b7b-0000-4000-8000-${String(100 + i).padStart(12, "0")}`));
    const store = storeOf([demoScreen, other]);
    const name = first().Name;
    const out = applyOps([{ op: "moveObject", screen: "Second", target: name, dx: 30, dy: 0 } as Op], store);
    expect(out.rejected).toEqual([]);
    const onSecond = partsOf(store.getState().screens[1])[0];
    expect(onSecond.Location.Left, `${name} on screen Second (the op named it); the one on ${demoScreen.Name} moved instead`).toBe(partsOf(other)[0].Location.Left + 30);
  });
});
