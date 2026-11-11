import { describe, expect, it } from "vitest";
import { createProjectStore } from "@/store/project";
import type { Screen } from "@/lib/ote/schema";

const screen = (id: string, parts: string[] = []): Screen =>
  ({
    Type: "Screen",
    UniqueId: id,
    Name: id,
    Children: [{ Type: "ViewBox", UniqueId: `${id}-view`, Name: "ViewBox", Options: 108, Width: 800, Height: 480, Children: parts.map((p) => ({ Type: "Rectangle", UniqueId: p, Name: p, Left: 0, Top: 0, Width: 10, Height: 10 })) }],
  }) as unknown as Screen;

describe("the handle counter", () => {
  it("never gives out a NaN handle when the counter arrives missing", () => {
    const store = createProjectStore();
    store.getState().hydrate({ screens: [screen("a", ["p1"])], handles: { a: "s1", p1: "o2" }, handleSeq: undefined } as never);
    store.getState().commitBatch("add", { ...store.getState(), screens: [screen("a", ["p1"]), screen("b", ["p2"])], handleSeq: undefined } as never);
    const { handles, handleSeq } = store.getState();
    expect(Object.values(handles).some((h) => h.includes("NaN"))).toBe(false);
    expect(handles.b).toBe("s3");
    expect(handles.p2).toBe("o4");
    expect(handleSeq).toBe(4);
  });

  it("repairs handles a NaN counter already spoiled", () => {
    const store = createProjectStore();
    store.getState().hydrate({ screens: [screen("a"), screen("b")], handles: { a: "s1", b: "sNaN" }, handleSeq: null } as never);
    expect(store.getState().handles).toEqual({ a: "s1", b: "s2" });
  });
});
