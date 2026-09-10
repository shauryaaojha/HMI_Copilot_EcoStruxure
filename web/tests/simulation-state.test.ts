/**
 * The invariant behind a crash the tests could not see.
 *
 * Generating from the 1,248-tag sample streams a couple of hundred alarm
 * events. Each is a store write, each gives `alarms` and `bindings` a new
 * identity, and useSimulation listed them as effect dependencies while calling
 * `setTags({})` on the not-simulating path. A fresh `{}` is never Object.is
 * equal to the last, so every store write ran the effect and every effect run
 * scheduled a render from inside the commit phase - which React counts as a
 * nested update and, past fifty of them, throws "Maximum update depth
 * exceeded". It landed after the objects appeared, which is why it looked like
 * a generation failure rather than a rendering one.
 *
 * There is no DOM environment here and package.json is frozen, so the hook
 * itself cannot be rendered. What can be pinned is the property the fix rests
 * on, extracted as a pure function: the idle state must be referentially
 * idempotent. If someone replaces it with `() => ({})` again, this fails.
 */

import { describe, expect, it } from "vitest";
import { NO_TAGS, idleTags } from "@/components/canvas/useSimulation";
import { objectValues } from "@/lib/sim/alarms";

describe("the idle simulation state is referentially stable", () => {
  it("returns the identical object when already idle", () => {
    expect(idleTags(NO_TAGS)).toBe(NO_TAGS);
  });

  it("settles after one call, however many times it is applied", () => {
    const first = idleTags({ PMP_101_RUN: true });
    expect(first).toBe(NO_TAGS);
    // The second call is the one that mattered: React re-runs the reducer, and
    // a new object here is a committed render for a state that did not change.
    expect(idleTags(first)).toBe(first);
    expect(idleTags(idleTags(idleTags(first)))).toBe(first);
  });

  it("is empty, so nothing on the canvas reads a stale live value", () => {
    expect(Object.keys(NO_TAGS)).toHaveLength(0);
    expect(objectValues([{ tag: "T", targetId: "", targetName: "O", property: "p" }], NO_TAGS)).toEqual({});
  });

  it("never hands back a mutated shared object", () => {
    // NO_TAGS is module-level, so anything writing into it would poison every
    // later simulation. Nothing should, and this is the tripwire.
    const before = JSON.stringify(NO_TAGS);
    idleTags({ a: 1 });
    idleTags(NO_TAGS);
    expect(JSON.stringify(NO_TAGS)).toBe(before);
  });
});
