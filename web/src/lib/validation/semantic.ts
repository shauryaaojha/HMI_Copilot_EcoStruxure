/**
 * Semantic validation: whether the screen says what the plant is.
 *
 * The format checks ask whether the file is well formed and the geometric
 * critic whether the screen is legible. Neither notices a perfectly drawn
 * indicator labelled "Level" on a pump's flow, a lamp on Pump 101's card
 * driven by Pump 102, or a pump with a fault tag that nothing on any screen
 * shows. Those are what an operator gets wrong at three in the morning, and
 * every one of them is visible in the project before anything is drawn - so
 * they are checked here, deterministically, on every validation, with no
 * model in the loop. docs/PLAN_PHASE5.md §4.
 */

import type { PackageInput } from "@/lib/ote/packager";
import type { Part } from "@/lib/ote/schema";
import { isReading, modelPlant, type PlantModel } from "@/lib/plant/model";
import { critiqueHeadlines } from "@/lib/critic/coverage";
import type { Finding } from "./rules";

/** Measurement words a label can carry, and the role each one names. */
const MEASURES: [RegExp, string][] = [
  [/\blevel\b/i, "level"],
  [/\bflow\b/i, "flow"],
  [/\bpressure\b/i, "pressure"],
  [/\btemperature\b|\btemp\b/i, "temperature"],
  [/\bspeed\b/i, "speed"],
  [/\bcurrent\b/i, "current"],
  [/\bposition\b/i, "position"],
  [/\bhours\b/i, "hours"],
  [/\bvolume\b/i, "volume"],
  [/\bpower\b/i, "power"],
  [/\bfrequency\b/i, "frequency"],
];
const MEASURED = new Set(MEASURES.map(([, role]) => role));

/** The label beside a value, by the naming every generator here uses. */
function labelNameFor(value: string): string[] {
  const out: string[] = [];
  if (value.endsWith("_Val")) out.push(`${value.slice(0, -4)}_Lbl`);
  for (const [num, lbl] of [["Num_", "Lbl_"], ["DetailNum_", "DetailLbl_"], ["TileNum_", "TileLbl_"]]) {
    if (value.startsWith(num)) out.push(lbl + value.slice(num.length));
  }
  return out;
}

const keyOf = (id: string) => id.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

export function validateSemantics(project: PackageInput, model?: PlantModel): Finding[] {
  const plant = model ?? modelPlant(project.variables);
  const findings: Finding[] = [];
  const parts = project.screens.flatMap((s) => s.Children[0].Children);
  const byName = new Map(parts.map((p) => [p.Name, p]));

  const ownerOf = new Map<string, PlantModel["equipment"][number]>();
  const roleOf = new Map<string, string>();
  for (const e of plant.equipment) {
    for (const r of e.roles) {
      ownerOf.set(r.tag, e);
      roleOf.set(r.tag, r.role);
    }
  }
  const shown = new Set(project.wires.map((w) => w.tag));
  const alarmed = new Set(project.alarms.map((a) => a.Trigger));

  // --- the wrong measurement under the right number ----------------------------
  for (const wire of project.wires) {
    if (wire.part.Type !== "NumericDisplay") continue;
    const role = roleOf.get(wire.tag);
    if (!role || !MEASURED.has(role)) continue;
    const label = labelNameFor(wire.part.Name).map((n) => byName.get(n)).find((p): p is Extract<Part, { Type: "TextBox" }> => p?.Type === "TextBox");
    if (!label) continue;
    const said = MEASURES.filter(([pattern]) => pattern.test(label.Text)).map(([, r]) => r);
    if (said.length === 0 || said.includes(role)) continue;
    findings.push({
      severity: "warning",
      rule: "semantic.metric",
      objectId: label.UniqueId,
      tag: wire.tag,
      message: `"${label.Text}" is shown over ${wire.tag}, which is a ${role}, not a ${said.join(" or ")}.`,
      suggestion: `Relabel it "${role}", or bind the ${said[0]} reading of that equipment instead.`,
    });
  }

  // --- one machine's object driven by another's tag -----------------------------
  const keys = new Map(plant.equipment.map((e) => [keyOf(e.id), e]));
  for (const wire of project.wires) {
    const owner = ownerOf.get(wire.tag);
    if (!owner) continue;
    const segments = wire.part.Name.toUpperCase().split("_");
    const named = [...new Set(segments.filter((s) => keys.has(s)))];
    if (named.length !== 1) continue;
    const claimed = keys.get(named[0])!;
    if (claimed.id === owner.id) continue;
    findings.push({
      severity: "warning",
      rule: "semantic.wrongEquipment",
      objectId: wire.part.UniqueId,
      tag: wire.tag,
      message: `${wire.part.Name} belongs to ${claimed.label} but is driven by ${wire.tag}, a tag of ${owner.label}.`,
      suggestion: `Bind ${wire.part.Name} to a ${claimed.label} tag, or move it to ${owner.label}.`,
    });
  }

  // --- equipment on screen without its state or its commands ------------------------
  const uncontrolled: PlantModel["equipment"] = [];
  for (const e of plant.equipment) {
    const tags = e.roles.map((r) => r.tag);
    if (!tags.some((t) => shown.has(t))) continue;
    for (const r of e.roles) {
      if (r.dataType !== "BOOL") continue;
      if (r.role === "fault" && !shown.has(r.tag) && !alarmed.has(r.tag)) {
        findings.push({
          severity: "warning",
          rule: "semantic.missingState",
          tag: r.tag,
          message: `${e.label} is on a screen, but its fault ${r.tag} is shown nowhere and raises no alarm.`,
          suggestion: `Put a fault lamp for ${r.tag} on its faceplate, or add a bit alarm triggered by it.`,
        });
      }
      if (r.role === "running" && !shown.has(r.tag)) {
        findings.push({
          severity: "info",
          rule: "semantic.missingState",
          tag: r.tag,
          message: `${e.label} is on a screen, but whether it is running (${r.tag}) is shown nowhere.`,
          suggestion: `Add a running lamp for ${r.tag}.`,
        });
      }
    }
    const commands = e.roles.filter((r) => r.role === "command" && r.dataType === "BOOL");
    if (commands.length > 0 && !commands.some((c) => shown.has(c.tag))) uncontrolled.push(e);
  }
  // One finding, not one per unit: a monitoring-only overview leaves every
  // command off by design, and forty identical lines would bury the rest.
  if (uncontrolled.length > 0) {
    const first = uncontrolled[0];
    findings.push({
      severity: "info",
      rule: "semantic.missingCommand",
      tag: first.roles.find((r) => r.role === "command")?.tag,
      message: `${uncontrolled.length} unit${uncontrolled.length === 1 ? " has" : "s have"} commands no screen controls: ${uncontrolled.slice(0, 5).map((e) => e.label).join(", ")}${uncontrolled.length > 5 ? ", …" : ""}.`,
      suggestion: `Ask for their detail screens ("faceplate for ${first.id}"), which carry the commands - or leave them monitored only, if that is the intent.`,
    });
  }

  // --- what the class would lead with ------------------------------------------------
  // Only for equipment with a reading on screen: the model's opinion about a
  // pump nobody is looking at is not a finding about this project.
  const onScreen = new Set(plant.equipment.filter((e) => e.roles.some((r) => isReading(r.dataType) && shown.has(r.tag))).map((e) => e.id));
  findings.push(...critiqueHeadlines({ ...plant, equipment: plant.equipment.filter((e) => onScreen.has(e.id)) }));

  return findings;
}
