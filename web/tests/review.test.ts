/** Whether a conversational edit commits at once or waits for the engineer. */
import { describe, expect, it } from "vitest";
import { commitsWithoutReview } from "@/lib/ai/review";
import { DEFAULT_STANDARDS } from "@/store/types";

describe("reviewing AI edits", () => {
  it("commits a clean edit by default, as before", () => {
    expect(DEFAULT_STANDARDS.reviewAiEdits).toBeUndefined();
    expect(commitsWithoutReview({ rejected: [] }, DEFAULT_STANDARDS)).toBe(true);
  });
  it("proposes anything rejected or deleted, as before", () => {
    expect(commitsWithoutReview({ rejected: ["x"] }, DEFAULT_STANDARDS)).toBe(false);
    expect(commitsWithoutReview({ rejected: [], deleted: 1 }, DEFAULT_STANDARDS)).toBe(false);
  });
  it("proposes every edit when the project asks for review", () => {
    expect(commitsWithoutReview({ rejected: [] }, { ...DEFAULT_STANDARDS, reviewAiEdits: true })).toBe(false);
  });
});

import { dryRun, commit } from "@/lib/ai/applier";
import { createProjectStore } from "@/store/project";
import { demoScreen, demoVariables } from "@/fixtures";
import { labelOp, selectedOps } from "@/lib/ai/review";
import type { Op } from "@/lib/ai/ops";

describe("accepting some of a proposal", () => {
  it("labels each op as the engineer reads it", () => {
    expect(labelOp({ op: "setText", target: "o4", text: "Pump 1" })).toBe('Set text o4 "Pump 1"');
    expect(labelOp({ op: "bindTag", target: "o7", tag: "FT_101_PV" })).toBe("Bind tag o7 to FT_101_PV");
    expect(labelOp({ op: "deleteObject", target: "o9", note: "Remove the spare lamp" })).toBe("Remove the spare lamp");
  });

  it("keeps the ticked ops in order", () => {
    expect(selectedOps(["a", "b", "c"], new Set([2, 0]))).toEqual(["a", "c"]);
  });

  it("lands only the ticked ops, as one undo step", () => {
    const store = createProjectStore();
    store.getState().hydrate({ id: "p", name: "P", screens: [structuredClone(demoScreen)], activeScreenId: demoScreen.UniqueId, variables: structuredClone(demoVariables) });
    const texts = store.getState().screens[0].Children[0].Children.filter((p) => p.Type === "TextBox").slice(0, 2);
    const ops: Op[] = texts.map((t, i) => ({ op: "setText", target: t.Name, text: `Changed ${i}` }));
    const run = dryRun(selectedOps(ops, new Set([1])), store);
    expect(run.outcome.rejected).toEqual([]);
    commit(run, "partial", store);
    const after = store.getState().screens[0].Children[0].Children;
    const textOf = (name: string) => JSON.stringify(after.find((p) => p.Name === name));
    expect(textOf(texts[1].Name)).toContain("Changed 1");
    expect(textOf(texts[0].Name)).not.toContain("Changed 0");
    store.getState().undo();
    expect(JSON.stringify(store.getState().screens[0].Children[0].Children.find((p) => p.Name === texts[1].Name))).not.toContain("Changed 1");
  });
});
