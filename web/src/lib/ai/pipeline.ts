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

import { gridFor, HEADER, NAV, Placer, type LayoutUnit } from "@/lib/ote/layout";
import { modelPlant, rangeOf } from "@/lib/plant/model";
import { architectPrograms, programOf, type ScreenProgram } from "@/lib/program/program";
import { compileProgram, kpiBandHeight, specOf } from "@/lib/program/compile";
import { DEFAULT_PANEL } from "@/lib/backend/panels";
import { libraryAvailable, symbolsFor } from "@/lib/ote/symbols";
import type { Wire } from "@/lib/ote/bindings";
import type { Alarm, Screen, Variable } from "@/lib/ote/schema";
import { validateProject } from "@/lib/validation/rules";
import type { GenerationEvent, PipelineStep } from "@/types/events";
import { inferEquipment, LEVEL_ALARM_SHARE, proposeAlarms } from "./infer";
import {
  activeProvider,
  fallbackPlan,
  fitToLimits,
  hasApiKey,
  limitsFor,
  planScreen,
  type Provider,
  type ScreenPlan,
} from "./plan";

const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

const log = (message: string): GenerationEvent => ({ type: "log", at: now(), message });

const step = (
  s: PipelineStep,
  state: "running" | "done" | "failed",
  detail?: string,
): GenerationEvent => ({ type: "step", step: s, state, detail });

/** A screen the application already has, so an extension plans around it. */
export interface ExistingScreen {
  name: string;
  level: 1 | 2 | 3;
  /** Equipment ids already placed on it. */
  include: string[];
}

export interface PipelineInput {
  intent: string;
  variables: Variable[];
  /**
   * When set, this is an extension of an application that already exists:
   * only unplaced equipment is planned, screen names already taken are never
   * reused, and the navigation strip lists every screen. docs/LLD.md F5.
   */
  existing?: ExistingScreen[];
  /**
   * The panel being designed for. One object, from the request to the
   * validation: the planner sizes screens by it, the layout measures against
   * it, the project is validated as it. The default profile when absent.
   */
  panel?: { model: string; width: number; height: number };
}

const PROVIDER_NAME: Record<Provider, string> = {
  gemini: "Gemini",
  claude: "Claude",
};

export async function* runPipeline(
  input: PipelineInput,
): AsyncGenerator<GenerationEvent> {
  const { intent, variables } = input;
  const existing = input.existing ?? [];
  const extending = existing.length > 0;
  const panel = input.panel ?? { model: DEFAULT_PANEL.model, width: DEFAULT_PANEL.width, height: DEFAULT_PANEL.height };
  const SCREEN = { width: panel.width, height: panel.height };
  const limits = limitsFor(panel);

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
  // The Plant Model first: it reads a bare _PV by the equipment's class, so a
  // tank's PV is a level and a valve's is a position everywhere downstream -
  // the plan, the faceplates, the alarms - rather than a "Value" on one screen
  // and a level on another.
  const plant = modelPlant(variables);
  const roleOf = new Map(plant.equipment.flatMap((e) => e.roles.map((r) => [r.tag, r.role] as const)));
  const equipment = inferEquipment(variables).map((unit) => ({
    ...unit,
    roles: unit.roles.map((r) => ({ ...r, role: roleOf.get(r.tag) ?? r.role })),
  }));
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

  /**
   * Extending: the units already on a screen are not planned again. The
   * second request for "the whole plant" used to lay the whole plant out a
   * second time beside the first.
   */
  const placed = new Set(existing.flatMap((s) => s.include));
  const toPlan = extending ? equipment.filter((u) => !placed.has(u.id)) : equipment;
  if (extending) {
    yield log(
      `Extending an application of ${existing.length} screen${existing.length === 1 ? "" : "s"}: ${toPlan.length} of ${equipment.length} units still to place`,
    );
    if (toPlan.length === 0) {
      yield step("select", "failed", "every unit is already on a screen");
      yield {
        type: "error",
        message:
          "Every unit in the tag list is already on a screen. Ask for a change to a screen instead, or import more tags.",
      };
      return;
    }
  }

  if (configured) {
    // The model call is the only slow step - seconds, against milliseconds for
    // everything else. Saying which provider is being asked keeps that gap
    // legible instead of looking like a stall. It states what is happening, not
    // what anything is thinking.
    yield log(`Asking ${waitingOn === "gemini" ? "Gemini" : "Claude"} to read the request`);
    try {
      const planned = await planScreen(intent, toPlan, limits);
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
  plan ??= fallbackPlan(intent, toPlan, limits);
  // Whatever wrote the plan, no screen holds more than its level holds on this
  // panel: the overflow becomes the next screen rather than being laid out
  // below the bottom edge and lost.
  {
    const before = plan.screens.length;
    plan = { ...plan, screens: fitToLimits(plan.screens, limits, new Set(existing.map((s) => s.name.toLowerCase()))) };
    if (plan.screens.length > before) {
      yield log(`Split into ${plan.screens.length} screens: a ${panel.width}x${panel.height} panel holds ${limits[2]} faceplates per unit overview`);
    }
  }

  if (extending) {
    // A name the application already uses is never reused: the packager's
    // hierarchy keys screens by name, and the store would rename it to
    // PumpStation1_2, which is the duplicate the engineer complained about.
    const taken = new Set(existing.map((s) => s.name.toLowerCase()));
    plan = {
      ...plan,
      screens: plan.screens.map((spec) => {
        let name = spec.screenName;
        for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${spec.screenName}${n}`;
        taken.add(name.toLowerCase());
        return { ...spec, screenName: name };
      }),
    };
  }

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

  /**
   * The product's own drawing of each machine, where this installation has one.
   *
   * inference already decided that a PMP is a "Pumps/Pump01"; nothing had ever
   * looked the hint up. It resolves to a real Path part with the geometry out
   * of the .path file - the same object an engineer drags off the library
   * palette - so a generated faceplate carries Schneider's own pump rather than
   * the word PUMP.
   *
   * The index is derived from a local EcoStruxure installation and is never
   * committed, so on any other machine this finds nothing and the screens come
   * out exactly as they did before. That is said out loud rather than left as a
   * silent difference between two machines.
   */
  const graphics = await symbolsFor(equipment.map((unit) => unit.symbol));
  // The Plant Model: ranges for every indicator, and the structure the
  // process view will follow. Built from the same tags, stated as a document
  // the engineer corrects on the Plant page rather than on every screen.
  yield { type: "plant", model: plant };
  const drawn: LayoutUnit[] = equipment.map((unit) => ({
    ...unit,
    graphic: unit.symbol ? graphics.get(unit.symbol) : undefined,
    ranges: plant.equipment.find((e) => e.id === unit.id)?.ranges,
  }));

  const withGraphic = drawn.filter((unit) => unit.graphic).length;
  if (withGraphic > 0) {
    yield log(
      `Placed ${withGraphic} shipped graphic object${withGraphic === 1 ? "" : "s"} from the installation's library`,
    );
  } else if (!(await libraryAvailable())) {
    yield log(
      "No graphic object library on this machine - faceplates are drawn without symbols",
    );
  }

  // Every screen is a Screen Program (docs/ARCHITECTURE_SCREEN_QUALITY.md
  // §3.4), and one: the planner's screens - what the engineer asked for - and
  // the architect's process views and overview KPIs, which read the same
  // requested readings, compiled by the one compiler on one placer so names
  // stay unique across the application. The navigation lists them all before
  // anything is laid out.
  const readings = [...new Set(plan.screens.flatMap((s) => s.readings ?? []))];
  const architected = architectPrograms(plant, { readings });
  const programs: ScreenProgram[] = plan.screens.map((spec) => programOf(spec, plan!.rationale));
  const takenNames = new Set([...existing.map((s) => s.name.toLowerCase()), ...programs.map((p) => p.name.toLowerCase())]);

  // The overview KPIs: on the planned overview when there is one and its
  // tiles still fit below them, as their own L1 screen when the plan made
  // none. Never a second overview beside the engineer's.
  const kpiOverview = architected.find((p) => p.level === 1 && p.kpis.length > 0);
  if (kpiOverview) {
    const planned = programs.find((p) => p.level === 1);
    const hasOverview = planned || existing.some((s) => s.level === 1);
    if (planned) {
      const wantsAlarms = planned.sections?.includes("alarms") ?? false;
      const below = HEADER + NAV + 16 + kpiBandHeight(kpiOverview.kpis.length, panel);
      if (gridFor(1, panel, wantsAlarms, below).capacity >= (planned.faceplates?.length ?? 0)) {
        planned.kpis = kpiOverview.kpis;
        yield log(`Overview ${planned.name} leads with ${planned.kpis.length} KPI${planned.kpis.length === 1 ? "" : "s"}: ${kpiOverview.rationale}`);
      } else {
        yield log(`Overview ${planned.name} keeps its ${planned.faceplates?.length ?? 0} tiles; the KPIs would not fit above them`);
      }
    } else if (!hasOverview && !takenNames.has(kpiOverview.name.toLowerCase())) {
      programs.unshift(kpiOverview);
      takenNames.add(kpiOverview.name.toLowerCase());
    }
  }
  const processPrograms = architected.filter((p) => p.process && !takenNames.has(p.name.toLowerCase()));
  programs.push(...processPrograms);

  const navigation = [
    ...existing.map((s) => ({
      screenName: s.name,
      title: s.name,
      level: s.level,
      include: s.include,
      sections: [] as ("status" | "process" | "alarms")[],
    })),
    ...programs.map(specOf),
  ];
  const place = new Placer();
  const laidOut = programs.map((program) => compileProgram(program, plant, SCREEN, navigation, graphics, place, drawn));
  if (processPrograms.length > 0) {
    yield log(`Process views from the Plant Model: ${processPrograms.map((p) => `${p.title} (${p.rationale})`).join("; ")}`);
  }
  if (readings.length > 0) {
    yield log(`Every screen leads with the readings asked for: ${readings.slice(0, 6).join(", ")}${readings.length > 6 ? ", …" : ""}`);
  }
  for (const note of laidOut.flatMap((l) => l.notes ?? [])) yield log(note);
  const screens: Screen[] = [];
  const wires: Wire[] = [];

  for (const { screen, parts, wires: screenWires, composites } of laidOut) {
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
    for (const c of composites) yield { type: "composite", ...c };
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
    ? proposeAlarms(equipment, (tag) => rangeOf(plant, tag)).map((p) => ({
        Message: p.message,
        Trigger: p.trigger,
        AlarmType: p.level,
        AlarmRecordType: p.kind === "bit" ? 1 : 2,
        Severity: p.severity,
        Value: p.value,
      }))
    : [];
  for (const alarm of alarms) yield { type: "alarm", alarm };
  yield step("alarms", "done", `${alarms.length} proposed`);
  if (alarms.length > 0) {
    const bit = alarms.filter((a) => a.AlarmRecordType === 1).length;
    // Proposed, not configured: priority, deadband, delay and the operator's
    // response are the engineer's to decide, and the log must not claim them.
    yield log(
      `Proposed ${alarms.length} alarms (${bit} bit, ${alarms.length - bit} level, thresholds at ${LEVEL_ALARM_SHARE.hi * 100}/${LEVEL_ALARM_SHARE.hihi * 100}% of range) - to be confirmed: no deadband, delay or rationalised priority yet`,
    );
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
    target: { model: panel.model, width: panel.width, height: panel.height },
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
