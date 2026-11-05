/**
 * One way to ask for a component, for chat, the agent and MCP alike.
 *
 * The asker names a kind, what it is for (a piece of equipment, a tag) and
 * where it goes relative to something. It never names a number or a colour:
 * size comes from the catalogue and colour from the theme.
 */

import { COMPONENTS, sizeFor } from "./index";
import { COMPONENT_KINDS, type ComponentKind, type ComponentUse, type SizeName } from "./types";

/** What a piece of equipment offers a component: its label and its tags by role. */
export interface EquipmentForComponent {
  id: string;
  label?: string;
  roles: readonly { role: string; tag: string; dataType: string }[];
}

export interface ComponentAsk {
  kind: ComponentKind;
  variant?: string;
  size?: SizeName;
  /** Tags by role. Wins over what the equipment offers. */
  tags?: Record<string, string>;
  /** One tag, for the kind's main role. */
  tag?: string;
  equipment?: EquipmentForComponent;
  label?: string;
  props?: Record<string, unknown>;
  name?: string;
}

/** Throws a sentence that can go straight back to whoever asked. */
export function componentUse(ask: ComponentAsk): ComponentUse {
  const def = COMPONENTS[ask.kind];
  const variant = ask.variant ?? def.variants[0];
  if (!def.variants.includes(variant)) {
    throw new Error(`${ask.kind} has no variant ${variant}; it has ${def.variants.join(", ")}.`);
  }
  const slots = new Set(def.roles.map((slot) => slot.role));
  for (const role of Object.keys(ask.tags ?? {})) {
    if (!slots.has(role)) throw new Error(`${ask.kind} has no role ${role}; it has ${[...slots].join(", ") || "none"}.`);
  }
  const offered = Object.fromEntries((ask.equipment?.roles ?? [])
    .filter((role) => {
      const slot = def.roles.find((candidate) => candidate.role === role.role);
      return slot && (slot.dataType === role.dataType || (slot.dataType === "REAL" && role.dataType !== "BOOL" && role.dataType !== "STRING"));
    })
    .map((role) => [role.role, role.tag]));
  const main = def.roles.find((slot) => slot.required)?.role ?? def.roles[0]?.role;
  const tags = { ...offered, ...(ask.tag && main ? { [main]: ask.tag } : {}), ...ask.tags };
  const label = ask.label ?? ask.equipment?.label;
  const raw = { ...(label ? { label } : {}), ...ask.props };
  const parsed = def.props.safeParse(raw);
  if (!parsed.success) throw new Error(`${ask.kind} cannot take those properties: ${parsed.error.issues[0]?.message ?? "invalid"}.`);
  return { kind: ask.kind, variant, size: ask.size ?? "M", tags, props: parsed.data as Record<string, unknown>, ...(ask.name ? { name: ask.name } : {}) };
}

export const sizeOfUse = (use: ComponentUse) => sizeFor(use.kind, use.variant, use.size, use.density);

/** The catalogue, as whoever is about to choose reads it. */
export function componentCatalogue() {
  return COMPONENT_KINDS.map((kind) => {
    const def = COMPONENTS[kind];
    return {
      kind,
      variants: [...def.variants],
      sizes: def.sizes,
      roles: def.roles.map((slot) => ({ role: slot.role, dataType: slot.dataType, required: slot.required })),
    };
  });
}
