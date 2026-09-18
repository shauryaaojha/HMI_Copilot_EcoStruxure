/**
 * The pack's rules, applied to a project. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.5.
 *
 * Deterministic, keyless, runs on every validation. Each finding names the
 * object, so the Validation page can put the engineer in front of it, and
 * the same rule text the model was given is what fails here - the pack is
 * the single source.
 *
 * Severities are deliberate. A colour outside the pack is a warning, not an
 * error: a project opened from the product has its own colours, and the
 * right response is "apply the Standard", not a red wall. Density and the
 * font floor are warnings for the same reason. Off-grid is information.
 */

import type { Finding } from "@/lib/validation/rules";
import type { PackageInput } from "@/lib/ote/packager";
import type { Part } from "@/lib/ote/schema";
import { DEFAULT_PACK, fontFloor, neutralSet, signalSet, type StandardPack } from "./pack";

type Face = Record<string, unknown>;

const colourOf = (holder: Face | undefined, key: string): number | undefined => {
  const paint = holder?.[key] as { Color?: { Value?: number } } | undefined;
  const v = paint?.Color?.Value;
  return typeof v === "number" ? v : undefined;
};

/**
 * Where a part keeps its colours: the part itself for a display, one face
 * per state for a lamp or a switch. `normal` marks the faces a quiet screen
 * shows, where a signal colour is a mistake rather than a message.
 */
function facesOf(part: Part): { face: Face; label: string; normal: boolean }[] {
  const p = part as unknown as Face;
  switch (part.Type) {
    case "Lamp":
    case "ToggleSwitch":
      return [
        { face: p.Off as Face, label: "Off", normal: true },
        { face: p.On as Face, label: "On", normal: false },
      ];
    case "Switch":
      return [
        { face: p.Release as Face, label: "Release", normal: true },
        { face: p.Press as Face, label: "Press", normal: false },
      ];
    case "N-StateLamp":
      return [
        ...(part.States.map((s, i) => ({ face: s as Face, label: `state ${i}`, normal: i === 0 }))),
        ...(part.Invalid ? [{ face: part.Invalid as Face, label: "Invalid", normal: false }] : []),
      ];
    case "Pipe":
      return [
        ...(part.States.map((s, i) => ({ face: s as Face, label: `state ${i}`, normal: i === 0 }))),
        ...(part.Invalid ? [{ face: part.Invalid as Face, label: "Invalid", normal: false }] : []),
      ];
    // A trend's channel colours are data series, which need to be told
    // apart; they are the one accepted use of hue on a quiet screen.
    case "TrendGraph":
    case "BlockTrend":
      return [{ face: { Fill: p.Fill, Border: p.Border }, label: "", normal: true }];
    case "AlarmSummary":
      return [];
    default:
      return [{ face: p, label: "", normal: true }];
  }
}

const VALUE_TYPES = new Set<Part["Type"]>([
  "NumericDisplay", "Lamp", "N-StateLamp", "StringDisplay", "BarScale", "TrendGraph", "BlockTrend", "DateTimeDisplay",
]);

export function lintPack(project: PackageInput, pack: StandardPack = DEFAULT_PACK): Finding[] {
  const findings: Finding[] = [];
  const neutral = neutralSet(pack);
  const signal = signalSet(pack);
  const floor = fontFloor(pack);
  const grid = pack.rules.grid;

  for (const screen of project.screens) {
    const parts = screen.Children[0].Children;

    // --- colour.abnormalOnly -------------------------------------------
    for (const part of parts) {
      for (const { face, label, normal } of facesOf(part)) {
        for (const key of ["Fill", "Border", "TextColor", "Stroke"]) {
          const c = colourOf(face, key);
          if (c === undefined) continue;
          const where = label ? `${part.Name} ${label} ${key}` : `${part.Name} ${key}`;
          if (!neutral.has(c) && !signal.has(c)) {
            findings.push({
              severity: "warning",
              rule: "colour.abnormalOnly",
              objectId: part.UniqueId,
              message: `${where} uses palette colour ${c}, which the ${pack.name} pack does not use: colour is for alarms and abnormal states only.`,
              suggestion: "Use a pack token: ground, panel, line, ink, or an alarm priority colour on an abnormal face.",
            });
          } else if (normal && signal.has(c)) {
            findings.push({
              severity: "warning",
              rule: "colour.abnormalOnly",
              objectId: part.UniqueId,
              message: `${where} is an alarm colour on a normal face; a quiet screen must show no alarm colour.`,
              suggestion: "Keep the resting face neutral and put the colour on the abnormal state.",
            });
          }
        }
      }
    }

    // --- text.fontFloor -------------------------------------------------
    for (const part of parts) {
      for (const { face, label } of facesOf(part)) {
        const size = (face?.Font as { Size?: number } | undefined)?.Size;
        if (size !== undefined && size < floor) {
          findings.push({
            severity: "warning",
            rule: "text.fontFloor",
            objectId: part.UniqueId,
            message: `${part.Name}${label ? ` ${label}` : ""} is ${size}pt; the floor for a ${pack.rules.viewing === "touch" ? "touch panel" : "control room display"} is ${floor}pt.`,
            suggestion: `Set the font to ${floor}pt or larger.`,
          });
        }
      }
    }

    // --- layout.offGrid -------------------------------------------------
    for (const part of parts) {
      if (part.Type === "TextBox" || part.Type === "Path") continue; // labels sit inside their cards; symbols keep their shape
      const { Left, Top } = part.Location;
      if (Left % grid !== 0 || Top % grid !== 0) {
        findings.push({
          severity: "info",
          rule: "layout.offGrid",
          objectId: part.UniqueId,
          message: `${part.Name} is at ${Left}, ${Top}, off the ${grid}px grid.`,
          suggestion: "Snap it: shift-arrow nudges by the grid.",
        });
      }
    }

    // --- density.max ----------------------------------------------------
    const values = parts.filter((p) => VALUE_TYPES.has(p.Type)).length;
    if (values > pack.rules.density.valuesPerScreen) {
      findings.push({
        severity: "warning",
        rule: "density.max",
        message: `${screen.Name} shows ${values} live values; the pack allows ${pack.rules.density.valuesPerScreen} before a screen becomes a wall.`,
        suggestion: "Split the screen by unit, or move detail to a faceplate.",
      });
    }
  }

  return findings;
}
