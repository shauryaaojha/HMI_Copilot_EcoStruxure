/**
 * S1-09 (docs/audit/BUGS.md), moved from web/scripts/audit/s1-ops-concurrency.test.ts
 * with the fix: an op that named a screen still edited the first object of that
 * name on any screen. Names are now looked up on the op's screen first.
 * (The audit proof moved by dx; the Banner spans the panel, so a dx is clamped
 * to 0 either way. A dy shows which one moved.)
 */
import { expect, it } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { applyOps, type Op } from "@/core/ops";
import type { Screen } from "@/lib/ote/schema";
import { createProjectStore, DEFAULT_STANDARDS } from "@/store/project";

const partsOf = (s: Screen) => s.Children[0].Children;

it("an op that names a screen edits the object on that screen, not a namesake elsewhere", () => {
  const other = structuredClone(demoScreen);
  other.UniqueId = "7b7b7b7b-0000-4000-8000-000000000001";
  other.Name = "Second";
  other.Children[0].UniqueId = "7b7b7b7b-0000-4000-8000-000000000002";
  partsOf(other).forEach((p, i) => (p.UniqueId = `7b7b7b7b-0000-4000-8000-${String(100 + i).padStart(12, "0")}`));
  const store = createProjectStore();
  store.getState().hydrate({
    id: "p", name: "A", target: { model: "HMIST6500AWADI", width: 1024, height: 600 }, screens: [structuredClone(demoScreen), other],
    activeScreenId: demoScreen.UniqueId, variables: structuredClone(demoVariables), alarms: [], bindings: [], objectMeta: {},
    screenPlacement: {}, standards: DEFAULT_STANDARDS, versions: [], chat: [], foreign: {},
  } as never);
  const name = partsOf(demoScreen)[0].Name;
  const top = partsOf(demoScreen)[0].Location.Top;

  const out = applyOps([{ op: "moveObject", screen: "Second", target: name, dx: 0, dy: 30 } as Op], store);

  expect(out.rejected).toEqual([]);
  const [first, second] = store.getState().screens;
  expect(partsOf(second)[0].Location.Top, `${name} on screen Second (the op named it)`).toBe(top + 30);
  expect(partsOf(first)[0].Location.Top, `${name} on ${demoScreen.Name} moved instead`).toBe(top);
});
