/**
 * Apply the Standard to a screen that was not built from it.
 *
 * A project opened from the product, a screen imported from another one, or
 * the demo drawn before the pack existed: all of them carry their own
 * colours. This rewrites every colour that is not a pack token into the
 * token that plays its role, and raises every font to the floor, and says
 * what it changed per object - which is the "apply the Standard with a
 * per-object diff" of REENGINEERING.md §6 Phase C, in its first form.
 *
 * The role of a colour is read from where it sits, not from what it is:
 *   - on a resting face (a Rectangle, a label, a Lamp's Off), a fill becomes
 *     panel (or ground, when the rectangle is the screen), a border becomes
 *     line, text becomes ink;
 *   - on an abnormal face (On, Press, a state above the first), a green-ish
 *     fill means "running" and becomes white with the running outline; a
 *     red-ish one is priority 1, amber or yellow priority 2, blue or purple
 *     priority 4. That is the handbook's mapping of legacy colours, and it is
 *     the assumption an engineer should check on the diff.
 * Trend channel strokes are left alone: data series need their hues.
 */

import type { Part } from "@/lib/ote/schema";
import { COLOR_SETS } from "@/lib/ote/palette";
import { DEFAULT_PACK, fontFloor, neutralSet, signalSet, type StandardPack } from "./pack";

type Face = Record<string, unknown>;

export interface Applied {
  parts: Part[];
  /** One line per change, naming the object. */
  changes: string[];
}

function hsl(index: number, colorSet: number): { h: number; s: number; l: number } {
  const value = COLOR_SETS[colorSet as keyof typeof COLOR_SETS]?.colors[index - 1] ?? 0;
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0))
    : max === g ? (b - r) / d + 2
    : (r - g) / d + 4;
  h *= 60;
  return { h, s, l };
}

/** A grey to the nearest neutral by lightness. */
function nearestNeutral(index: number, pack: StandardPack): number {
  const { l } = hsl(index, pack.colorSet);
  const t = pack.tokens;
  const candidates = [t.ink, t.muted, t.line, t.ground, t.panel, t.white];
  let best = t.panel;
  let gap = Infinity;
  for (const c of candidates) {
    const d = Math.abs(hsl(c, pack.colorSet).l - l);
    if (d < gap) {
      gap = d;
      best = c;
    }
  }
  return best;
}

/** What a saturated colour on an abnormal face was trying to say. */
function signalRole(index: number, pack: StandardPack): "running" | "p1" | "p2" | "p4" {
  const { h } = hsl(index, pack.colorSet);
  if (h >= 75 && h < 170) return "running";
  if (h >= 170 && h < 300) return "p4";
  if (h >= 35 && h < 75) return "p2";
  return "p1";
}

const colourIndex = (face: Face, key: string): number | undefined => {
  const v = (face[key] as { Color?: { Value?: number } } | undefined)?.Color?.Value;
  return typeof v === "number" ? v : undefined;
};
const setColour = (face: Face, key: string, index: number) => {
  face[key] = { Color: { Value: index } };
};

interface FaceRef {
  face: Face;
  label: string;
  normal: boolean;
}

function facesOf(part: Part): FaceRef[] {
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
    case "Pipe":
      return [
        ...part.States.map((s, i) => ({ face: s as Face, label: `state ${i}`, normal: i === 0 })),
        ...(part.Invalid ? [{ face: part.Invalid as Face, label: "Invalid", normal: false }] : []),
      ];
    case "TrendGraph":
    case "BlockTrend":
    case "AlarmSummary":
      return [];
    default:
      return [{ face: p, label: "", normal: true }];
  }
}

export function applyPack(
  input: Part[],
  pack: StandardPack = DEFAULT_PACK,
  screen?: { width: number; height: number },
): Applied {
  const neutral = neutralSet(pack);
  const signal = signalSet(pack);
  const floor = fontFloor(pack);
  const t = pack.tokens;
  const changes: string[] = [];
  const parts = structuredClone(input);

  for (const part of parts) {
    const isGround =
      part.Type === "Rectangle" &&
      screen !== undefined &&
      part.Width * part.Height >= 0.9 * screen.width * screen.height;

    for (const { face, label, normal } of facesOf(part)) {
      const where = label ? `${part.Name} ${label}` : part.Name;
      let runningFace = false;

      for (const key of ["Fill", "Border", "TextColor", "Stroke"]) {
        const c = colourIndex(face, key);
        if (c === undefined) continue;
        if (neutral.has(c)) continue;
        if (signal.has(c) && !normal) continue;

        const { s } = hsl(c, pack.colorSet);
        let next: number;
        if (s < 0.15) {
          next = nearestNeutral(c, pack);
        } else if (normal) {
          next =
            key === "Fill" ? (isGround ? t.ground : key === "Fill" && part.Type === "NumericDisplay" ? t.white : t.panel)
            : key === "TextColor" ? t.ink
            : t.line;
        } else {
          const role = signalRole(c, pack);
          if (role === "running") {
            if (key === "Fill") {
              next = t.white;
              runningFace = true;
            } else if (key === "TextColor") next = t.ink;
            else next = t.runningLine;
          } else {
            const tone = role === "p1" ? t.alarmP1 : role === "p2" ? t.alarmP2 : t.alarmP4;
            next = key === "TextColor" ? t.onAlarm : tone;
          }
        }
        if (next !== c) {
          setColour(face, key, next);
          changes.push(`${where} ${key}: colour ${c} → ${next}`);
        }
      }

      if (runningFace) {
        if (colourIndex(face, "Border") === undefined || neutral.has(colourIndex(face, "Border")!)) {
          setColour(face, "Border", t.runningLine);
        }
        if ((face.Thickness as number | undefined) !== 2) {
          face.Thickness = 2;
          changes.push(`${where}: running shown by the outline`);
        }
      }

      // Contrast, on every face: a label that was white on the old green
      // banner is white on a light panel now; a running face that was white
      // on green is white on white. Light text on a light fill becomes ink.
      // (Priority 3 is the light alarm colour, and the handbook puts black
      // text on yellow for the same reason.)
      {
        const text = colourIndex(face, "TextColor");
        const fillNow = colourIndex(face, "Fill");
        const light = new Set([t.white, t.panel, t.ground, t.alarmP3]);
        const onLight = fillNow === undefined ? part.Type === "TextBox" : light.has(fillNow);
        if (text !== undefined && light.has(text) && onLight) {
          setColour(face, "TextColor", t.ink);
          changes.push(`${where} TextColor: colour ${text} → ${t.ink} for contrast`);
        }
      }

      const font = face.Font as { Size?: number } | undefined;
      if (font && typeof font.Size === "number" && font.Size < floor) {
        changes.push(`${where}: font ${font.Size}pt → ${floor}pt`);
        font.Size = floor;
      }
    }
  }

  return { parts, changes };
}
