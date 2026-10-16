/**
 * A project - the store, or a shared project's snapshot - as the packager and
 * the checks take it.
 *
 * The editor exports a browser-only project from its store. A shared project
 * is exported on the server from its own snapshot at a stated revision, so a
 * half-synced browser can never be what ends up in the file. Both go through
 * this one function, so the two exports cannot drift apart.
 */
import type { Wire } from "@/lib/ote/bindings";
import type { Alarm } from "@/lib/ote/schema";
import { alarmTriggers } from "@/lib/sim/alarms";
import type { Doc } from "./types";

/** Everything /api/export and /api/validate need, from a store state or a snapshot. */
export function packageInputOf(doc: Pick<Doc, "name" | "target" | "screens" | "variables" | "alarms" | "bindings" | "plant" | "source">) {
  // Keyed with the screen, not just the part: a Target carries ScreenId, so a
  // multi-screen project has to bind each object to the screen it is on.
  const byId = new Map(
    doc.screens.flatMap((screen) =>
      screen.Children[0].Children.map((part) => [part.UniqueId, { part, screenId: screen.UniqueId }] as const),
    ),
  );

  const wires: Wire[] = doc.bindings.flatMap((binding) => {
    const found = byId.get(binding.targetId);
    if (!found) return [];
    return [
      {
        part: found.part,
        tag: binding.tag,
        property: binding.property,
        screenId: found.screenId,
        ...(binding.converter ? { converter: binding.converter } : {}),
      },
    ];
  });

  // The product stores an alarm's trigger as a binding, not a column, so it is
  // recovered from the bindings before the packager is asked to write it back.
  const triggers = alarmTriggers(doc.bindings);
  const alarms: Alarm[] = doc.alarms.map((alarm, i) => ({
    ...alarm,
    Trigger: alarm.Trigger || triggers.get(i + 1) || "",
  }));

  return {
    name: doc.name,
    target: doc.target,
    screens: doc.screens,
    variables: doc.variables,
    alarms,
    wires,
    plant: doc.plant,
    // Set when the project was opened from a file: export writes back into it.
    source: doc.source,
  };
}
