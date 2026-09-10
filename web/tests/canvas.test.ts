/**
 * The Phase 2 gate: the browser canvas and tools/render_screen.py must draw the
 * same screen from the same JSON.
 *
 * docs/BUILD_PLAN.md asks for this comparison to be a test, because "one model,
 * two renderers - the preview cannot lie about the output" stops being true the
 * moment the two disagree and nothing notices. assets/screen_design.png is what
 * the Python renderer produced from src/fixtures/pump-station.screen.json; the
 * rules it used are restated here, independently, and checked against the SVG
 * the browser renderer emits from the same fixture.
 *
 * Restating rather than importing is deliberate. A shared helper would let both
 * renderers drift together and still pass.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoAlarms, demoBindings, demoLiveValues, demoScreen } from "@/fixtures";
import { resolveColor } from "@/lib/ote/palette";
import { ScreenRenderer } from "@/components/canvas/ScreenRenderer";
import type { Part } from "@/lib/ote/schema";
import { activeAlarms, alarmTriggers, tagValues } from "@/lib/sim/alarms";

/* The palette indices render_screen.py resolves, by the names it uses. */
const PAPER = resolveColor(2); // #f1f1f1 - the screen background
const CHROME = resolveColor(22); // #515151 - borders and the alarm header
const WHITE = resolveColor(21); // #ffffff
const LAMP_OFF = resolveColor(11); // #d9d9d9

function render(options: Parameters<typeof ScreenRenderer>[0]) {
  return renderToStaticMarkup(createElement(ScreenRenderer, options));
}

const base = { screen: demoScreen, selectedIds: [] as string[] };

/** Every <rect> in the markup, as an attribute bag. */
function rects(markup: string) {
  return [...markup.matchAll(/<rect\b([^>]*)\/?>/g)].map((m) => {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    return attrs;
  });
}

/**
 * PIL draws a rectangle's outline inside the box; SVG straddles the path. The
 * canvas insets by half the stroke so the two land on the same pixels.
 */
function expectedBox(part: { Location: { Left: number; Top: number }; Width: number; Height: number }, stroke: number) {
  const half = stroke / 2;
  return {
    x: String(part.Location.Left + half),
    y: String(part.Location.Top + half),
    width: String(part.Width - stroke),
    height: String(part.Height - stroke),
  };
}

function findRect(markup: string, want: Record<string, string>) {
  return rects(markup).find((r) => Object.entries(want).every(([k, v]) => r[k] === v));
}

const parts = demoScreen.Children[0].Children;
const byType = <T extends Part["Type"]>(type: T) =>
  parts.filter((p): p is Extract<Part, { Type: T }> => p.Type === type);

describe("the canvas draws what render_screen.py drew", () => {
  const markup = render(base);

  it("puts the screen on the project's paper colour, not on a theme colour", () => {
    expect(markup).toContain(`background:${PAPER}`);
  });

  it("frames the screen the way render_screen.py frames it", () => {
    const view = demoScreen.Children[0];
    expect(
      findRect(markup, {
        x: "0.5",
        y: "0.5",
        width: String(view.Width - 1),
        height: String(view.Height - 1),
        stroke: CHROME,
      }),
    ).toBeDefined();
  });

  it("emits one addressable node per object, carrying its UniqueId", () => {
    expect(parts.length).toBe(19);
    for (const part of parts) {
      expect(markup).toContain(`data-object-id="${part.UniqueId}"`);
      expect(markup).toContain(`data-object-name="${part.Name}"`);
    }
  });

  it("draws rectangles with the fixture's own fill and border, stroke inside", () => {
    for (const part of byType("Rectangle")) {
      const stroke = part.Thickness ?? 1;
      expect(findRect(markup, { ...expectedBox(part, stroke), "stroke-width": String(stroke) })).toBeDefined();
    }
  });

  it("draws a lamp in its Off state with a double-width border", () => {
    // The Python renderer uses width=2*SCALE for a lamp, whatever its Thickness.
    for (const part of byType("Lamp")) {
      const stroke = (part.Off.Thickness ?? 1) * 2;
      const rect = findRect(markup, expectedBox(part, stroke));
      expect(rect, `no rect for ${part.Name}`).toBeDefined();
      expect(rect?.["stroke-width"]).toBe(String(stroke));
      expect(rect?.fill).toBe(LAMP_OFF);
      expect(markup).toContain((part.Off.Text ?? "").split("\n")[0]);
    }
  });

  it("shows a numeric display's design value at its own precision", () => {
    for (const part of byType("NumericDisplay")) {
      expect(findRect(markup, { ...expectedBox(part, part.Thickness ?? 1), fill: WHITE })).toBeDefined();
      expect(markup).toContain(part.CurrentValue.toFixed(part.DecimalDigits ?? 0));
    }
  });

  it("pads left-aligned label text by 8px, as place() does", () => {
    const label = byType("TextBox").find((p) => p.Name === "Lbl_Flow");
    expect(label).toBeDefined();
    expect(markup).toContain(`x="${label!.Location.Left + 8}"`);
  });

  it("draws the alarm summary grid rather than an empty white box", () => {
    const summary = byType("AlarmSummary")[0];
    expect(summary).toBeDefined();

    // A 30px header band filled with the chrome colour.
    expect(
      findRect(markup, {
        x: String(summary.Location.Left),
        y: String(summary.Location.Top),
        width: String(summary.Width),
        height: "30",
        fill: CHROME,
      }),
    ).toBeDefined();

    for (const column of ["TIME", "VARIABLE", "MESSAGE", "SEV", "STATE"]) {
      expect(markup).toContain(`>${column}</tspan>`);
    }
    expect(markup).toContain("No active alarms");
  });

  it("lists an alarm once the simulator has raised it", () => {
    const live = render({
      ...base,
      alarms: [
        {
          time: "10:14:22",
          variable: "PMP_102_FLT",
          message: "Pump 2 fault",
          severity: "5",
          state: "ACTIVE",
        },
      ],
    });
    expect(live).not.toContain("No active alarms");
    expect(live).toContain("PMP_102_FLT");
    expect(live).toContain("Pump 2 fault");
    // render_screen.py tints an alarm row #ffecec.
    expect(findRect(live, { fill: "#ffecec" })).toBeDefined();
  });

  it("swaps a lamp to its On state when a value is pushed", () => {
    const running = render({ ...base, values: { Lamp_PUMP1_RUN: true } });
    const lamp = byType("Lamp").find((p) => p.Name === "Lamp_PUMP1_RUN")!;
    expect(running).toContain((lamp.On.Text ?? "").split("\n")[0]);
  });
});

describe("the chrome cannot reach the screen", () => {
  it("renders no application token, in either theme", () => {
    // The claim in docs/WORKSTREAMS.md is that the HMI screen is never themed by
    // us. It holds only while nothing in the drawn output resolves through
    // globals.css - so the object markup must carry palette hex and nothing else.
    const markup = render(base);
    const objects = markup.slice(0, markup.lastIndexOf("<rect")); // drop our own frame
    expect(objects).not.toMatch(/--color-surface|--color-text|--color-line|--color-chrome|--color-ink/);
    for (const colour of [...objects.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)]) {
      expect(
        Array.from({ length: 60 }, (_, i) => resolveColor(i + 1)).includes(colour[1]) ||
          colour[1] === "#ffecec",
        `${colour[1]} is not in the project palette`,
      ).toBe(true);
    }
  });
});

describe("the alarm summary is driven by the project's own bindings", () => {
  // src/fixtures/pump-station.project.json has no Trigger column, because the
  // product stores an alarm's trigger as a binding rather than as a field. The
  // sim engine recovers it from the binding list; these are the two rows
  // tools/render_screen.py shows in assets/screen_live.png.
  const bindings = flattenForTest();

  it("recovers each alarm's trigger variable from its binding", () => {
    const triggers = alarmTriggers(bindings);
    expect(triggers.get(1)).toBe("PMP_101_FLT");
    expect(triggers.get(2)).toBe("PMP_102_FLT");
    expect(triggers.get(4)).toBe("LT_101_PV");
  });

  it("translates object values to tag values through the bindings", () => {
    const values = tagValues(bindings, { Lamp_PUMP2_FLT: true, Num_Level: 91.8 });
    expect(values.PMP_102_FLT).toBe(true);
    expect(values.LT_101_PV).toBe(91.8);
  });

  it("raises a bit alarm on its bit and a level alarm on its setpoint", () => {
    const rows = activeAlarms(demoAlarms, bindings, demoLiveValues);
    const raised = rows.map((r) => `${r.variable}:${r.message}`);
    // Pump 2 faulted, and the tank is at 91.8 - over Hi (85), under HiHi (95).
    expect(raised).toContain("PMP_102_FLT:Pump 2 fault");
    expect(raised).toContain("LT_101_PV:Tank level high");
    expect(raised).not.toContain("LT_101_PV:Tank level critically high");
    expect(raised).not.toContain("PMP_101_FLT:Pump 1 fault");
    // Most severe first, as the product orders its own summary.
    expect(rows[0].severity).toBe("5");
    expect(rows.every((r) => r.state === "ACTIVE")).toBe(true);
  });

  it("raises nothing in the design state, which is what the fixture renders", () => {
    expect(activeAlarms(demoAlarms, bindings, {})).toEqual([]);
  });
});

/** The same flattening Workspace.tsx does when it hydrates the store. */
function flattenForTest() {
  const sourceById = new Map(demoBindings.Sources.map((s) => [s.ReferenceId, s]));
  const targetById = new Map(demoBindings.Targets.map((t) => [t.ReferenceId, t]));
  return demoBindings.Bindings.flatMap((b) => {
    const target = targetById.get(b.Target);
    const source = sourceById.get(Number(b.Sources.split(",")[0].trim()));
    if (!target || !source) return [];
    return [
      {
        tag: source.ObjectFullName,
        targetId: "",
        targetName: target.ObjectFullName,
        property: b.TargetProperty,
      },
    ];
  });
}
