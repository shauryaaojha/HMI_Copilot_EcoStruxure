/**
 * Tags and a sentence in, a packable project out, on the server.
 *
 * The browser builds a project by streaming pipeline events into the store.
 * The CLI, the agent loop and the bench need the same result without a
 * browser, so this collects the events into a PackageInput directly. It is the
 * code scripts/build-bar-demo.mts and scripts/bench-set.mts each had a copy of.
 */

import { runPipeline, type PipelineInput } from "@/lib/ai/pipeline";
import type { PackageInput } from "@/lib/ote/packager";
import { screenOf } from "@/lib/ote/parts";
import type { Alarm, Part, Variable } from "@/lib/ote/schema";
import type { Wire } from "@/lib/ote/bindings";
import type { GenerationEvent } from "@/types/events";

export interface Built {
  input: PackageInput;
  /** Every event the pipeline emitted, for a caller that narrates. */
  events: GenerationEvent[];
  /** Pipeline log lines, in order. */
  log: string[];
}

export async function buildFromTags(
  options: { name: string; intent: string; variables: Variable[]; panel: { model: string; width: number; height: number } } & Pick<PipelineInput, "structure" | "programs">,
  onEvent?: (event: GenerationEvent) => void,
): Promise<Built> {
  const partsBy = new Map<string, Part[]>();
  const bindings: { tag: string; target: string; property: string; converter?: { min: number; max: number } }[] = [];
  const alarms: Alarm[] = [];
  const events: GenerationEvent[] = [];
  const log: string[] = [];
  for await (const e of runPipeline({ intent: options.intent, variables: options.variables, panel: options.panel, structure: options.structure, programs: options.programs })) {
    events.push(e);
    onEvent?.(e);
    if (e.type === "object") {
      const key = e.screenName ?? "Screen";
      if (!partsBy.has(key)) partsBy.set(key, []);
      partsBy.get(key)!.push(e.part);
    }
    if (e.type === "binding") bindings.push(e);
    if (e.type === "alarm") alarms.push(e.alarm);
    if (e.type === "log") log.push(e.message);
    if (e.type === "error") throw new Error(e.message);
  }
  const screens = [...partsBy].map(([name, parts]) => screenOf(name, parts, options.panel));
  const owner = new Map(screens.flatMap((s) => s.Children[0].Children.map((p) => [p.Name, { part: p, screenId: s.UniqueId }] as const)));
  const wires: Wire[] = bindings.flatMap((b) => {
    const found = owner.get(b.target);
    return found ? [{ part: found.part, tag: b.tag, property: b.property, screenId: found.screenId, ...(b.converter ? { converter: b.converter } : {}) }] : [];
  });
  return { input: { name: options.name, target: options.panel, screens, variables: options.variables, alarms, wires }, events, log };
}
