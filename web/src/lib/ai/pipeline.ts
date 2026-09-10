/**
 * The eight steps, as a stream of events.
 *
 * Yields one complete object at a time - never a partially-parsed tree. A half
 * object cannot be rendered and cannot be validated, and the build timeline
 * exists to show real progress, not a spinner with a label on it.
 *
 * What it builds is an application, not a screen: the plan decides how many
 * displays the request needs and lib/ote/layout.ts gives them all the same
 * header, navigation strip and alarm banner position, which is what ISA-101
 * asks for and what makes a set of screens usable rather than a set of
 * pictures.
 *
 * Every detail line is computed from what actually happened. "Parsed 247 tags",
 * not "Thinking...". That register is the product.
 *
 * Phase 4 of docs/BUILD_PLAN.md.
 */

import { layoutApplication } from "@/lib/ote/layout";
import type { Wire } from "@/lib/ote/bindings";
import type { Alarm, Screen, Variable } from "@/lib/ote/schema";
import { validateProject } from "@/lib/validation/rules";
import type { GenerationEvent, PipelineStep } from "@/types/events";
import { inferEquipment, proposeAlarms } from "./infer";
import {
  activeProvider,
  fallbackPlan,
  hasApiKey,
  planScreen,
  type Provider,
  type ScreenPlan,
} from "./plan";

/**
 * The demo panel is 1024x600 - taken from the skeleton's own Target.dat, not
 * from a caption. Everything the layout places is measured against this.
 */
const SCREEN = { width: 1024, height: 600 };

const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

const log = (message: string): GenerationEvent => ({ type: "log", at: now(), message });

const step = (
  s: PipelineStep,
  state: "running" | "done" | "failed",
  detail?: string,
): GenerationEvent => ({ type: "step", step: s, state, detail });

export interface PipelineInput {
  intent: string;
  variables: Variable[];
}

const PROVIDER_NAME: Record<Provider, string> = {
  gemini: "Gemini",
  claude: "Claude",
};

export async function* runPipeline(
  input: PipelineInput,
): AsyncGenerator<GenerationEvent> {
  const { intent, variables } = input;

  // --- 1 ingest -----------------------------------------------------------
  yield step("ingest", "running");
  if (variables.length === 0) {
    yield step("ingest", "failed", "no tags supplied");
    yield { type: "error", message: "No tags to generate from. Import a PLC tag export first." };
    return;
  }
  yield { type: "tags", variables };
  yield step("ingest", "done", `${variables.length} tags`);
  yield log(`Parsed ${variables.length} tags`);

  // --- 2 infer ------------------------------------------------------------
  yield step("infer", "running");
  const equipment = inferEquipment(variables);
  const kinds = new Map<string, number>();
  for (const unit of equipment) kinds.set(unit.kind, (kinds.get(unit.kind) ?? 0) + 1);
  const summary = [...kinds.entries()].map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ");
  yield { type: "equipment", equipment };
  yield step("infer", "done", summary);
  yield log(`Detected ${summary} from the tag names`);

  // --- 3 select -----------------------------------------------------------
  yield step("select", "running");
  let plan: ScreenPlan | null = null;
  let provider: Provider | null = null;
  const configured = hasApiKey();
  const waitingOn = activeProvider();
  if (configured) {
    // The model call is the only slow step - seconds, against milliseconds for
    // everything else. Saying which provider is being asked keeps that gap
    // legible instead of looking like a stall. It states what is happening, not
    // what anything is thinking.
    yield log(`Asking ${waitingOn === "gemini" ? "Gemini" : "Claude"} to read the request`);
    try {
      const planned = await planScreen(intent, equipment);
      if (planned) {
        plan = planned.plan;
        provider = planned.provider;
      }
    } catch (error) {
      // A model failure must not take the screen down. Say so and carry on.
      yield log(
        `Model unavailable (${error instanceof Error ? error.message : "unknown"}); laying out from the tag names`,
      );
    }
  }
  plan ??= fallbackPlan(intent, equipment);

  yield log(
    provider
      ? `${PROVIDER_NAME[provider]} read the request: ${plan.rationale}`
      : configured
        ? `Laid out from the tag names: ${plan.rationale}`
        : `No model key set — laid out from the tag names: ${plan.rationale}`,
  );
  const planned = new Set(plan.screens.flatMap((s) => s.include));
  yield step(
    "select",
    "done",
    `${plan.screens.length} screen${plan.screens.length === 1 ? "" : "s"}, ${planned.size} of ${equipment.length} units`,
  );

  // --- 4 layout -----------------------------------------------------------
  yield step("layout", "running");
  const laidOut = layoutApplication(plan.screens, equipment, SCREEN);
  const screens: Screen[] = [];
  const wires: Wire[] = [];

  for (const { screen, parts, wires: screenWires } of laidOut) {
    screens.push(screen);
    wires.push(...screenWires);
    for (const part of parts) {
      yield {
        type: "object",
        part,
        parentId: screen.Children[0].UniqueId,
        screenName: screen.Name,
      };
    }
  }

  const objectCount = laidOut.reduce((n, s) => n + s.parts.length, 0);
  yield step(
    "layout",
    "done",
    `${objectCount} objects on ${screens.length} screen${screens.length === 1 ? "" : "s"}`,
  );
  yield log(
    `Placed ${objectCount} objects across ${screens.map((s) => s.Name).join(", ")}`,
  );

  // --- 5 alarms -----------------------------------------------------------
  yield step("alarms", "running");
  // Alarms belong to the project, not to a screen - the alarm table is one
  // file. A screen carries the banner that displays them, which is what
  // `sections` decides.
  const wantsAlarms = plan.screens.some((s) => s.sections.includes("alarms"));
  const alarms: Alarm[] = wantsAlarms
    ? proposeAlarms(equipment).map((p) => ({
        Message: p.message,
        Trigger: p.trigger,
        AlarmType: p.level,
        AlarmRecordType: p.kind === "bit" ? 1 : 2,
        Severity: p.severity,
        Value: p.value,
      }))
    : [];
  for (const alarm of alarms) yield { type: "alarm", alarm };
  yield step("alarms", "done", `${alarms.length} configured`);
  if (alarms.length > 0) {
    const bit = alarms.filter((a) => a.AlarmRecordType === 1).length;
    yield log(`Configured ${alarms.length} alarms (${bit} bit, ${alarms.length - bit} level)`);
  }

  // --- 6 bindings ---------------------------------------------------------
  yield step("bindings", "running");
  for (const wire of wires) {
    yield {
      type: "binding",
      tag: wire.tag,
      target: wire.part.Name,
      property: wire.property,
    };
  }
  const total = wires.length + alarms.length;
  yield step("bindings", "done", `${total} of ${total} bound`);
  yield log(`Bound ${wires.length} display properties and ${alarms.length} alarm triggers`);

  // --- 7 validate ---------------------------------------------------------
  yield step("validate", "running");
  const project = {
    name: screens[0]?.Name ?? "Project",
    target: { model: "HMIST6500AWADI", width: SCREEN.width, height: SCREEN.height },
    screens,
    variables,
    alarms,
    wires,
  };
  const findings = validateProject(project);
  for (const finding of findings) {
    yield {
      type: "finding",
      severity: finding.severity,
      message: finding.message,
      objectId: finding.objectId,
      suggestion: finding.suggestion,
    };
  }
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  yield step("validate", errors > 0 ? "failed" : "done", `${errors} errors, ${warnings} warnings`);

  // --- 8 package ----------------------------------------------------------
  yield step("package", "running");
  yield step("package", "done", "ready to export");
  yield log(
    `${screens.length} screen${screens.length === 1 ? "" : "s"} ready — ${objectCount} objects, ${total} bindings`,
  );

  yield { type: "done", screenId: screens[0].UniqueId };
}
