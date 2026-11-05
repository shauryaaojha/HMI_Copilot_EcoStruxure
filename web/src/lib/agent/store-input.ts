import type { PackageInput } from "@/lib/ote/packager";
import type { Wire } from "@/lib/ote/bindings";
import { createProjectStore } from "@/store/project";

/** A store holding the project, so the edit ops the chat uses apply here too. */
export function storeOf(input: PackageInput) {
  const store = createProjectStore();
  store.getState().hydrate({
    name: input.name,
    target: input.target,
    screens: structuredClone(input.screens),
    activeScreenId: input.screens[0]?.UniqueId,
    variables: structuredClone(input.variables),
    alarms: structuredClone(input.alarms),
    bindings: input.wires.map((w) => ({ tag: w.tag, targetId: w.part.UniqueId, targetName: w.part.Name, property: w.property, ...(w.converter ? { converter: w.converter } : {}) })),
  } as never);
  return store;
}

/** The store back into what the packager takes. */
export function inputOf(store: ReturnType<typeof createProjectStore>): PackageInput {
  const s = store.getState();
  const byId = new Map(s.screens.flatMap((screen) => screen.Children[0].Children.map((part) => [part.UniqueId, { part, screenId: screen.UniqueId }] as const)));
  const wires: Wire[] = s.bindings.flatMap((b) => {
    const found = byId.get(b.targetId);
    return found ? [{ part: found.part, tag: b.tag, property: b.property, screenId: found.screenId, ...(b.converter ? { converter: b.converter } : {}) }] : [];
  });
  return { name: s.name, target: s.target, screens: s.screens, variables: s.variables, alarms: s.alarms, wires };
}
