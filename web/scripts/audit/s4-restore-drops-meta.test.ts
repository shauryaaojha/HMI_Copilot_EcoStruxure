/**
 * S4: restoring a version (History > Restore, or "revert to here" in the chat) brings
 * objects back without their provenance, lock, group or bind intent.
 *
 * A Version (store/types.ts:117-125) holds screens, variables, alarms and bindings only.
 * restore() (store/slices/collab.ts:386-401) puts those back and leaves objectMeta,
 * composites and programs as they are now. An object deleted after the version was
 * taken returns with no objectMeta: a generated part loses origin "generated" and its
 * regeneration key (so regeneration no longer matches it), a locked part comes back
 * unlocked, and a screens-first object loses its bindIntent.
 */
import { describe, expect, it } from "vitest";
import { createProjectStore } from "@/store/project";
import { demoScreen } from "@/fixtures";

describe("restoring a version", () => {
  it("brings an object back with the meta it had in that version", () => {
    const store = createProjectStore();
    const s = () => store.getState();
    s().hydrate({ id: "r", name: "R", screens: [structuredClone(demoScreen)], activeScreenId: demoScreen.UniqueId });
    const part = s().screens[0].Children[0].Children[0];
    s().markGenerated(part.UniqueId, "Card_PMP101");
    s().setMeta([part.UniqueId], { locked: true });
    const at = s().snapshot("checkpoint");

    s().setMeta([part.UniqueId], { locked: false });
    s().removeObjects([part.UniqueId]);
    s().restore(at);

    expect(s().screens[0].Children[0].Children.some((p) => p.UniqueId === part.UniqueId)).toBe(true);
    const meta = s().objectMeta[part.UniqueId];
    expect(meta?.key, "the restored object lost its regeneration key").toBe("Card_PMP101");
    expect(meta?.locked, "the restored object came back unlocked").toBe(true);
  });
});
