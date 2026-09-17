/**
 * After an extension, every screen's navigation strip lists every screen.
 *
 * The new screens are laid out knowing the whole set; the old ones were born
 * before it existed. Refreshing rebuilds the chips on every generated strip
 * and touches nothing else. docs/PLAN_PHASE1.md item 3.
 */

import { describe, expect, it } from "vitest";
import { layoutApplication, refreshNavigation, type LayoutUnit, type ScreenSpec } from "@/lib/ote/layout";
import type { Screen } from "@/lib/ote/schema";
import { demoScreen } from "@/fixtures";

const PANEL = { width: 1024, height: 600 };

const unit = (id: string): LayoutUnit => ({
  id,
  kind: "pump",
  label: id,
  roles: [
    { tag: `${id}_RUN`, role: "running", dataType: "BOOL", comment: "" },
    { tag: `${id}_FLT`, role: "fault", dataType: "BOOL", comment: "" },
  ],
});

const spec = (name: string, include: string[]): ScreenSpec => ({
  screenName: name,
  title: name,
  level: 2,
  include,
  sections: ["status"],
});

const labels = (screen: Screen) =>
  screen.Children[0].Children.flatMap((p) => (p.Type === "TextBox" && p.Name.startsWith("NavLbl_") ? [p.Text] : []));

const boxesExceptNav = (screen: Screen) =>
  screen.Children[0].Children.filter((p) => !/^NavChip_|^NavLbl_/.test(p.Name)).map((p) => [p.Name, p.Location.Left, p.Location.Top, p.Width, p.Height]);

describe("refreshNavigation", () => {
  it("makes every generated strip list every screen, current one first-class", () => {
    const first = layoutApplication([spec("A", ["P1"]), spec("B", ["P2"])], [unit("P1"), unit("P2")], PANEL);
    const third = layoutApplication([spec("C", ["P3"])], [unit("P3")], PANEL, [
      spec("A", ["P1"]),
      spec("B", ["P2"]),
      spec("C", ["P3"]),
    ]);
    const screens = [...first.map((s) => s.screen), ...third.map((s) => s.screen)];

    expect(labels(screens[0])).toEqual(["A", "B"]);
    expect(labels(screens[2])).toEqual(["A", "B", "C"]);

    const { screens: refreshed, changed } = refreshNavigation(screens, PANEL);
    expect(changed).toBe(true);
    for (const screen of refreshed) expect(labels(screen)).toEqual(["A", "B", "C"]);
  });

  it("moves nothing but the chips", () => {
    const first = layoutApplication([spec("A", ["P1"]), spec("B", ["P2"])], [unit("P1"), unit("P2")], PANEL);
    const screens = first.map((s) => s.screen);
    const extra = { ...structuredClone(screens[1]), UniqueId: "x", Name: "C" };
    const before = screens.map(boxesExceptNav);
    const { screens: refreshed } = refreshNavigation([...screens, extra], PANEL);
    expect(refreshed.slice(0, 2).map(boxesExceptNav)).toEqual(before);
  });

  it("leaves a screen with no generated strip alone", () => {
    const { screens, changed } = refreshNavigation([demoScreen], PANEL);
    expect(changed).toBe(false);
    expect(screens[0]).toBe(demoScreen);
  });

  it("is a no-op when the strips are already right", () => {
    const laid = layoutApplication([spec("A", ["P1"]), spec("B", ["P2"])], [unit("P1"), unit("P2")], PANEL);
    const { changed } = refreshNavigation(laid.map((s) => s.screen), PANEL);
    expect(changed).toBe(false);
  });
});
