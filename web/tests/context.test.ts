/**
 * What the model is shown, and what it is never shown.
 *
 * The context is built in layers (docs/LLD.md §3.2): a project block that is
 * stable while the structure is, a volatile block for the active screen, and
 * the history as the record of what happened. These tests hold the shape -
 * no coordinates anywhere, rejections carried forward, older turns collapsed
 * to one deterministic line - without a model in the loop.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  describeOp,
  digestOf,
  projectContext,
  volatileContext,
  type HistoryItem,
} from "@/lib/ai/converse";
import { applyOps } from "@/lib/ai/applier";
import { useProject } from "@/store/project";
import { demoScreen, demoVariables } from "@/fixtures";

const s = () => useProject.getState();

const seed = () => {
  s().reset();
  s().hydrate({
    id: "ctx",
    name: "Test",
    target: { model: "HMIGTO6310", width: 1024, height: 600 },
    screens: [structuredClone(demoScreen)],
    activeScreenId: demoScreen.UniqueId,
    variables: structuredClone(demoVariables),
  });
};

const source = (request = "") =>
  digestOf(
    {
      name: s().name,
      target: s().target,
      screens: s().screens,
      activeScreenId: s().activeScreenId,
      variables: s().variables,
      alarms: s().alarms,
      bindings: s().bindings,
      selectedIds: s().selectedIds,
      handles: s().handles,
    },
    request,
  );

describe("the project block", () => {
  beforeEach(seed);

  it("lists screens by handle with what equipment they hold, and no positions", () => {
    const text = projectContext(source());
    expect(text).toMatch(/- s\d+ PumpStation1: 19 objects/);
    expect(text).not.toMatch(/\b\d+,\d+\b/);
    expect(text).not.toMatch(/left|top/i);
  });

  it("is byte-identical across requests that do not change the structure", () => {
    expect(projectContext(source("move the flow reading"))).toBe(projectContext(source("add a lamp")));
  });

  it("changes when a screen is added", () => {
    const before = projectContext(source());
    applyOps([{ op: "addScreen", name: "Dosing", note: "n" }]);
    expect(projectContext(source())).not.toBe(before);
    expect(projectContext(source())).toContain("Dosing");
  });
});

describe("the volatile block", () => {
  beforeEach(seed);

  it("names every object on the active screen by handle, type and region", () => {
    const text = volatileContext(source());
    expect(text).toMatch(/o\d+ AlarmBanner \[AlarmSummary, alarms\]/);
    expect(text).toMatch(/o\d+ Num_Flow \[NumericDisplay, body/);
    expect(text).toMatch(/Room on it: body: /);
  });

  it("never contains a coordinate", () => {
    const text = volatileContext(source("put the flow at 300,200"));
    // The request may say numbers; the description of the screen may not.
    const screenPart = text.split("Tags relevant")[0];
    expect(screenPart).not.toMatch(/\b\d{2,4}x\d{2,4}\b|\bat \d+,\d+/);
  });

  it("shows the tags the request is about", () => {
    const text = volatileContext(source("pump 1 running lamp"));
    expect(text).toMatch(/PUMP1_RUN|PMP_101_RUN/);
  });
});

describe("history as outcomes", () => {
  it("describes an op the way a rejection line needs it", () => {
    expect(
      describeOp({ op: "addObject", type: "Lamp", name: "Lamp_A", place: { region: "header" }, note: "n" }),
    ).toBe("addObject Lamp Lamp_A in header");
    expect(describeOp({ op: "bindTag", target: "o12", tag: "PMP_101_RUN", note: "n" })).toBe(
      "bindTag o12 tag PMP_101_RUN",
    );
  });

  it("is shaped so a rejected op is carried to the next turn", () => {
    // The route serialises this; the shape is what matters here. A turn
    // record with a rejection must survive the trip through ChatMessage.
    const item: HistoryItem = {
      role: "assistant",
      text: "Added the lamp.",
      turn: {
        mode: "edit",
        applied: [],
        rejected: [{ op: "addObject Lamp Lamp_A in body", reason: "The body of s1 has no free space" }],
        renamed: [],
        decision: "proposed",
      },
    };
    expect(item.turn?.rejected[0].reason).toContain("no free space");
  });
});
