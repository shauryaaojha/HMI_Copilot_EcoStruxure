/**
 * S1-06 (docs/audit/BUGS.md), moved from web/scripts/audit/s1-ops-concurrency.test.ts
 * with the fix. Accepting a proposal landed the dry run's whole patch, drawn on
 * the project as it was when the proposal appeared, so an edit made while the
 * proposal waited was reverted. `commit` now re-runs the ops when the project
 * has moved since the run was drawn.
 */
import { expect, it } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { commit, dryRun, handleOf, type Op } from "@/core/ops";
import type { Screen } from "@/lib/ote/schema";
import { createProjectStore, DEFAULT_STANDARDS } from "@/store/project";

function storeOf(screens: Screen[]) {
  const store = createProjectStore();
  store.getState().hydrate({
    id: "p", name: "Audit", target: { model: "HMIST6500AWADI", width: 1024, height: 600 },
    screens: structuredClone(screens), activeScreenId: screens[0].UniqueId, variables: structuredClone(demoVariables),
    alarms: [], bindings: [], objectMeta: {}, screenPlacement: {}, standards: DEFAULT_STANDARDS, versions: [], chat: [], foreign: {},
  } as never);
  return store;
}
const partsOf = (s: Screen) => s.Children[0].Children;

it("accepting a proposal keeps an edit made after it was proposed, and still lands the proposal", () => {
  const [first, second] = partsOf(demoScreen);
  const live = storeOf([demoScreen]);
  const run = dryRun([{ op: "deleteObject", target: handleOf(live.getState(), first.UniqueId) } as Op], live);
  const moved = { left: second.Location.Left + 40, top: second.Location.Top, width: second.Width ?? 0, height: second.Height ?? 0 };
  live.getState().setBox(second.UniqueId, moved);

  const landed = commit(run, "Accepted proposal", live);

  const parts = partsOf(live.getState().screens[0]);
  expect(parts.find((p) => p.UniqueId === second.UniqueId)!.Location.Left, "the engineer's drag after the proposal").toBe(moved.left);
  expect(parts.some((p) => p.UniqueId === first.UniqueId), "the proposed delete").toBe(false);
  expect(landed.outcome.applied.length).toBeGreaterThan(0);
});

it("a run committed on the state it was drawn on lands as drawn", () => {
  const live = storeOf([demoScreen]);
  const run = dryRun([{ op: "deleteObject", target: handleOf(live.getState(), partsOf(demoScreen)[0].UniqueId) } as Op], live);
  expect(commit(run, "Edit", live)).toBe(run);
});
