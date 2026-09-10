/**
 * A stand-in for /api/generate, emitting the same events in the same order.
 *
 * docs/WORKSTREAMS.md says the SSE contract in src/types/events.ts is frozen,
 * so the timeline, the canvas and the binding map can all be built against it
 * before the route exists. This is that emitter. The moment FORMAT's pipeline
 * starts answering, useGeneration stops calling this and nothing else changes.
 *
 * Two things it deliberately does not do:
 *
 *   - it does not invent screen objects. Every object it emits is lifted from
 *     src/fixtures, which came out of a file that opens in OTE, so what appears
 *     on the canvas is something the packager can genuinely emit. A mock that
 *     drew a plausible-looking object nobody could export would turn the demo
 *     back into a mockup, which is the one thing docs/BUILD_PLAN.md forbids.
 *   - it does not narrate. Every detail line is computed from what actually
 *     happened - counts of tags, objects, bindings - because "Thinking..." is
 *     the register this product exists to replace.
 *
 * Phase 4 of docs/BUILD_PLAN.md.
 */

import type { Alarm, Part, Variable } from "@/lib/ote/schema";
import type { Equipment, GenerationEvent } from "@/types/events";
import { demoAlarms, demoBindings, demoScreen, demoVariables } from "@/fixtures";

const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

const log = (message: string): GenerationEvent => ({
  type: "log",
  at: now(),
  message,
});

/** Groups tags by the equipment prefix their names share. */
function inferEquipment(variables: Variable[]): Equipment[] {
  const groups = new Map<string, string[]>();

  for (const variable of variables) {
    // PMP_101_RUN -> PMP_101; FT_101_PV -> FT_101.
    const match = /^([A-Za-z]+_?\d+)/.exec(variable.Name);
    if (!match) continue;
    const key = match[1];
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(variable.Name);
  }

  const KIND: Record<string, { kind: string; symbol: string }> = {
    PMP: { kind: "pump", symbol: "03-Icons/Pumps/Pump01" },
    P: { kind: "pump", symbol: "03-Icons/Pumps/Pump01" },
    FT: { kind: "flow transmitter", symbol: "03-Icons/Instruments/Flow01" },
    LT: { kind: "level transmitter", symbol: "03-Icons/Tanks/Tank01" },
    TT: { kind: "temperature transmitter", symbol: "03-Icons/Instruments/Temp01" },
    MOTOR: { kind: "motor", symbol: "03-Icons/Motors/Motor01" },
  };

  return [...groups.entries()]
    .filter(([, tags]) => tags.length > 0)
    .map(([id, tags]) => {
      const prefix = id.split("_")[0].toUpperCase();
      const known = KIND[prefix];
      return {
        id,
        kind: known?.kind ?? "equipment",
        label: id.replace("_", " "),
        tags,
        symbol: known?.symbol,
      };
    });
}

export interface MockOptions {
  intent: string;
  variables: Variable[];
  /** Milliseconds between events; 0 runs the whole pipeline instantly. */
  pace?: number;
}

/**
 * Yields the run as an async iterable, so the consumer looks identical whether
 * the events came from here or off the wire.
 */
export async function* mockGeneration({
  intent,
  variables,
  pace = 90,
}: MockOptions): AsyncGenerator<GenerationEvent> {
  const wait = () => new Promise((resolve) => setTimeout(resolve, pace));
  // No tags means no equipment to infer, so there is nothing to lay out. The
  // fixtures used to stand in here, which meant an unreachable route turned a
  // brand-new blank project into the demo pump station.
  if (variables.length === 0) {
    yield {
      type: "error",
      message: "No tags to generate from. Import a PLC tag export first.",
    };
    return;
  }
  const tags = variables;

  const view = demoScreen.Children[0];
  const parentId = view.UniqueId;
  const parts: Part[] = view.Children;

  /* ---- 1. ingest ------------------------------------------------------ */
  yield { type: "step", step: "ingest", state: "running" };
  yield log(`Reading intent: "${intent.slice(0, 72)}${intent.length > 72 ? "…" : ""}"`);
  await wait();
  yield { type: "tags", variables: tags };
  yield log(`${tags.length} tags available, ${new Set(tags.map((t) => t.DataType)).size} data types`);
  yield {
    type: "step",
    step: "ingest",
    state: "done",
    detail: `${tags.length} tags parsed`,
  };

  /* ---- 2. infer ------------------------------------------------------- */
  yield { type: "step", step: "infer", state: "running" };
  await wait();
  const equipment = inferEquipment(tags);
  for (const item of equipment) {
    yield log(`Detected ${item.kind} ${item.label} from ${item.tags.length} tags`);
  }
  yield { type: "equipment", equipment };
  yield {
    type: "step",
    step: "infer",
    state: "done",
    detail:
      equipment.length === 0
        ? "no equipment inferred"
        : `${equipment.length} units: ${equipment.map((e) => e.label).join(", ")}`,
  };

  /* ---- 3. select ------------------------------------------------------ */
  yield { type: "step", step: "select", state: "running" };
  await wait();
  const kinds = [...new Set(parts.map((p) => p.Type))];
  yield log(`Selected part types: ${kinds.join(", ")}`);
  yield {
    type: "step",
    step: "select",
    state: "done",
    detail: `${kinds.length} part types`,
  };

  /* ---- 4. layout ------------------------------------------------------ */
  yield { type: "step", step: "layout", state: "running" };
  yield log(`Laying out ${view.Width} × ${view.Height}`);
  for (const part of parts) {
    await wait();
    yield { type: "object", part, parentId };
  }
  yield {
    type: "step",
    step: "layout",
    state: "done",
    detail: `${parts.length} objects placed`,
  };

  /* ---- 5. alarms ------------------------------------------------------ */
  yield { type: "step", step: "alarms", state: "running" };
  const alarms: Alarm[] = demoAlarms;
  for (const alarm of alarms) {
    await wait();
    yield { type: "alarm", alarm };
    yield log(`Alarm ${alarm.Message} (severity ${alarm.Severity})`);
  }
  yield {
    type: "step",
    step: "alarms",
    state: "done",
    detail: `${alarms.length} alarms configured`,
  };

  /* ---- 6. bindings ---------------------------------------------------- */
  yield { type: "step", step: "bindings", state: "running" };
  const sourceById = new Map(demoBindings.Sources.map((s) => [s.ReferenceId, s]));
  const targetById = new Map(demoBindings.Targets.map((t) => [t.ReferenceId, t]));
  let bound = 0;
  for (const binding of demoBindings.Bindings) {
    const target = targetById.get(binding.Target);
    const source = sourceById.get(Number(binding.Sources.split(",")[0].trim()));
    if (!target || !source) continue;
    await wait();
    bound += 1;
    yield {
      type: "binding",
      tag: source.ObjectFullName,
      target: target.ObjectFullName,
      property: binding.TargetProperty,
    };
  }
  yield {
    type: "step",
    step: "bindings",
    state: "done",
    detail: `${bound}/${demoBindings.Bindings.length} bound`,
  };

  /* ---- 7. validate ---------------------------------------------------- */
  yield { type: "step", step: "validate", state: "running" };
  await wait();
  const unbound = parts.filter(
    (p) =>
      (p.Type === "Lamp" || p.Type === "NumericDisplay") &&
      !demoBindings.Targets.some((t) => t.ObjectFullName === p.Name),
  );
  for (const part of unbound) {
    yield {
      type: "finding",
      severity: "warning",
      message: `${part.Name} has no tag binding`,
      objectId: part.UniqueId,
      suggestion: "Bind it in the binding map, or delete the object.",
    };
  }
  yield {
    type: "step",
    step: "validate",
    state: "done",
    detail:
      unbound.length === 0
        ? "0 errors, 0 warnings"
        : `0 errors, ${unbound.length} warnings`,
  };

  /* ---- 8. package ----------------------------------------------------- */
  yield { type: "step", step: "package", state: "running" };
  await wait();
  yield log(`Screen ready: ${parts.length} objects, ${tags.length} tags, ${alarms.length} alarms`);
  yield {
    type: "step",
    step: "package",
    state: "done",
    detail: "ready to export",
  };

  yield { type: "done", screenId: demoScreen.UniqueId };
}
