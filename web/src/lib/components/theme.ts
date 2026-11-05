import { resolveColor } from "@/lib/ote/palette";

export const TOKEN_NAMES = [
  "ground", "field", "line", "ink", "muted", "faint", "equipmentLine", "equipmentRunning",
  "equipmentStopped", "equipmentDisabled", "onDark", "processValue", "normalBand", "alarmLimit",
  "setpoint", "alarmP1", "alarmP2", "alarmP3", "alarmP4", "onAlarm", "commandFace",
  "commandPressed", "selected", "trend1", "trend2", "trend3", "trend4",
] as const;
export type Token = (typeof TOKEN_NAMES)[number];
export type Density = "compact" | "regular" | "large";
export interface TypeScale { label: number; value: number; title: number; small: number }
export interface Theme {
  colorSet: number;
  tokens: Record<Token, number>;
  type: Record<Density, TypeScale>;
  radii: { panel: number; field: number; button: number; indicator: number };
  stroke: { hairline: number; equipment: number; focus: number };
  touchMin: Record<Density, number>;
  grid: { unit: number; module: number };
}

export const DEFAULT_THEME: Theme = {
  colorSet: 4,
  tokens: {
    ground: 11, field: 21, line: 22, ink: 1, muted: 52, faint: 2,
    equipmentLine: 22, equipmentRunning: 12, equipmentStopped: 11, equipmentDisabled: 2,
    onDark: 21, processValue: 12, normalBand: 2, alarmLimit: 1, setpoint: 46,
    alarmP1: 55, alarmP2: 44, alarmP3: 18, alarmP4: 50, onAlarm: 21,
    commandFace: 21, commandPressed: 12, selected: 12,
    trend1: 12, trend2: 46, trend3: 33, trend4: 52,
  },
  type: {
    compact: { label: 12, value: 14, title: 14, small: 12 },
    regular: { label: 14, value: 20, title: 18, small: 12 },
    large: { label: 18, value: 24, title: 24, small: 14 },
  },
  radii: { panel: 4, field: 2, button: 6, indicator: 0 },
  stroke: { hairline: 1, equipment: 2, focus: 3 },
  touchMin: { compact: 32, regular: 40, large: 48 },
  grid: { unit: 4, module: 8 },
};

export function densityOf(panel: { width: number; height: number }): Density {
  if (panel.width <= 320 || panel.height <= 240) return "compact";
  if (panel.width >= 1280 && panel.height >= 800) return "large";
  return "regular";
}

export function contrastRatio(a: number, b: number, set: 4 = 4): number {
  const luminance = (index: number) => {
    const hex = resolveColor(index, "#000000", set);
    const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
    const linear = channels.map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
