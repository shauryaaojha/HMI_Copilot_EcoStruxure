/**
 * Proposing tags for objects drawn before the tags existed.
 *
 * Screens first, tags later (docs/HANDOFF_SCREENS_FIRST.md, step 2): when a
 * tag export arrives in a project that already has screens, every unbound
 * object that shows a value is matched against the tags. The match is only a
 * proposal - the engineer ticks what to bind - and anything this cannot tell
 * apart is left unbound and said so, the way the tag parser reports its
 * corrections instead of applying them quietly.
 *
 * Evidence, strongest first: the object's `bindIntent` naming a tag exactly;
 * the words of its name (and intent) against the words of the tag's name; and
 * the Plant Model's class and role for the tag, so "Lamp_P_101_Run" finds the
 * tag the model calls P_101's "running" signal.
 */
import type { Part, Screen, Variable } from "@/lib/ote/schema";
import { modelPlant } from "@/lib/plant/model";
import { ACCEPTS, VALUE_PROPERTY } from "@/lib/validation/rules";
import type { Binding, ObjectMeta } from "@/store/types";

export interface BindProposal {
  targetId: string;
  targetName: string;
  property: string;
  /** Absent when nothing, or more than one tag, fits. */
  tag?: string;
  /** High is proposed; low is listed and left unbound. */
  confidence: "high" | "low";
  reason: string;
}

/** Words that say what kind of object it is, not what it shows. */
const NOISE = new Set(["ind", "lamp", "num", "val", "lbl", "sw", "btn", "txt", "detail", "tile", "the", "of"]);
/** Spellings that mean the same signal. */
const SAME: Record<string, string> = {
  bar: "level", lvl: "level", temp: "temperature", press: "pressure", pres: "pressure",
  run: "running", flt: "fault", cmd: "command", spd: "speed",
};

/** Lower-case words of a name, split at underscores, case changes and digits. */
function words(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)|(\d)([A-Za-z])/g, "$1$3 $2$4")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !NOISE.has(w))
    .map((w) => SAME[w] ?? w);
}

/** The property a value drives on this part, or null for a part that shows nothing live. */
export function valuePropertyOf(part: Part): string | null {
  const known = VALUE_PROPERTY[part.Type];
  if (known) return known;
  const fill = part.Type === "Rectangle" ? part.Animation?.FillLevel : undefined;
  if (!fill) return null;
  return "VerticalFill" in fill ? "Animation.FillLevel.VerticalFill" : "Animation.FillLevel.HorizontalFill";
}

/** The data types that can drive this property: a fill takes a number, the rest what validation accepts. */
export function acceptedTypes(part: Part, property: string): Variable["DataType"][] | undefined {
  return property.startsWith("Animation.FillLevel.") ? ACCEPTS.NumericDisplay : ACCEPTS[part.Type];
}

function accepts(part: Part, property: string, variable: Variable): boolean {
  const allowed = acceptedTypes(part, property);
  return !allowed || allowed.includes(variable.DataType);
}

/** Every unbound value-showing object on the screens, with the tag it should take if one is clear. */
export function proposeBindings(project: {
  screens: Screen[];
  variables: Variable[];
  bindings: Binding[];
  objectMeta: Record<string, ObjectMeta>;
}): BindProposal[] {
  if (project.variables.length === 0) return [];
  const bound = new Set(project.bindings.map((b) => b.targetId));
  const byName = new Map(project.variables.map((v) => [v.Name.toUpperCase(), v]));

  // A tag's words are its name plus what the Plant Model makes of it.
  const tagWords = new Map(project.variables.map((v) => [v.Name, new Set(words(v.Name))]));
  for (const e of modelPlant(project.variables).equipment) {
    for (const r of e.roles) tagWords.get(r.tag)?.add(SAME[r.role] ?? r.role).add(e.class);
  }

  const out: BindProposal[] = [];
  for (const screen of project.screens) {
    for (const part of screen.Children[0].Children) {
      const property = valuePropertyOf(part);
      if (!property || bound.has(part.UniqueId)) continue;
      // A one-state pipe is drawn, not driven (the same exception validation makes).
      if (part.Type === "Pipe" && part.States.length <= 1) continue;
      const base = { targetId: part.UniqueId, targetName: part.Name, property };
      const intent = project.objectMeta[part.UniqueId]?.bindIntent?.trim() ?? "";

      const named = byName.get(intent.toUpperCase());
      if (named && accepts(part, property, named)) {
        out.push({ ...base, tag: named.Name, confidence: "high", reason: `its intent names ${named.Name}` });
        continue;
      }

      const mine = new Set([...words(part.Name), ...words(intent)]);
      const scored = project.variables
        .filter((v) => accepts(part, property, v))
        .map((v) => ({ v, score: [...tagWords.get(v.Name)!].filter((w) => mine.has(w)).length }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score);
      const [best, next] = scored;
      if (best && best.score >= 2 && (!next || next.score < best.score)) {
        const shared = [...tagWords.get(best.v.Name)!].filter((w) => mine.has(w));
        out.push({ ...base, tag: best.v.Name, confidence: "high", reason: `shares ${shared.join(", ")}` });
      } else if (best && next?.score === best.score) {
        const tied = scored.filter((c) => c.score === best.score).map((c) => c.v.Name);
        out.push({ ...base, confidence: "low", reason: `could be ${tied.slice(0, 3).join(" or ")}${tied.length > 3 ? ", …" : ""}` });
      } else {
        out.push({ ...base, confidence: "low", reason: "no tag fits its name" });
      }
    }
  }
  return out;
}
