import { rootBox, type Screen } from "@/lib/ote/schema";
import { pathPart } from "@/lib/ote/parts";
import { panelOf, resolveSlot } from "@/lib/ote/regions";

/** A symbol as a part in the body's next clear spot, or the sentence saying there is none. */
export function placeSymbol(screen: Screen, symbol: { name: string; Commands: string; Points: string }) {
  const view = screen.Children[0];
  const side = Math.round(Math.min(160, rootBox(view).width / 6));
  const slot = resolveSlot({ region: "body" }, view.Children, panelOf(screen), { width: side, height: side }, { screenLabel: screen.Name });
  if (!slot.ok) return { ok: false as const, reason: slot.reason };
  const part = pathPart(`Sym_${symbol.name.replace(/[^A-Za-z0-9_]/g, "")}`, { Commands: symbol.Commands, Points: symbol.Points }, slot.box);
  return { ok: true as const, part };
}
