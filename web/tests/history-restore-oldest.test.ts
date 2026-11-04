/**
 * S4-02 (docs/audit/BUGS.md), moved from web/scripts/audit/ with the fix.
 * S4: History > Restore on the oldest of twenty versions does nothing, but says it restored.
 *
 * HistoryScreen.goBackTo (src/components/history/HistoryScreen.tsx:310-316) runs
 *   snapshot("Before restore"); restore(at);
 * snapshot() unshifts and truncates the list to 20 (store/slices/collab.ts:381), so with
 * 20 versions the oldest one - the one being restored - is dropped before restore(at)
 * looks for it, and restore() returns silently (collab.ts:388-389). The log still says
 * "Restored version" and the page navigates to the workspace.
 */
import { describe, expect, it } from "vitest";
import { createProjectStore } from "@/store/project";
import { demoScreen } from "@/fixtures";

describe("restoring the oldest version when twenty are kept", () => {
  it("puts the project back the way that version had it", () => {
    const store = createProjectStore();
    const s = () => store.getState();
    s().hydrate({ id: "h", name: "H", screens: [structuredClone(demoScreen)], activeScreenId: demoScreen.UniqueId });
    const screenId = s().screens[0].UniqueId;
    const before = s().screens[0].Children[0].Children.length;

    let t = 1_000;
    const realNow = Date.now;
    Date.now = () => ++t; // a distinct `at` per version, as real clicks would have
    try {
      s().snapshot("v1");
      for (let i = 0; i < 19; i++) {
        s().appendObject(screenId, { Type: "Rectangle", UniqueId: crypto.randomUUID(), Name: `R${i}`, Location: { Left: 0, Top: 0 }, Width: 8, Height: 8 } as never);
        s().snapshot(`v${i + 2}`);
      }
      expect(s().versions).toHaveLength(20);
      const oldest = s().versions.at(-1)!;
      expect(oldest.description).toBe("v1");

      // Exactly what HistoryScreen.goBackTo does.
      s().restore(oldest.at, "Before restore");
    } finally {
      Date.now = realNow;
    }

    expect(
      s().screens[0].Children[0].Children.length,
      "restoring v1 of 20 left the 19 later objects on the screen: the version was dropped by the checkpoint taken first",
    ).toBe(before);
    expect(s().versions[0].description, "the present is kept as a version").toBe("Before restore");
    expect(s().versions).toHaveLength(20);
  });
});
