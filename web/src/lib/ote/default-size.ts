import type { PartType } from "./schema";

/** The size used when a canvas click places a part without a drag. */
export function partDefaultSize(type: PartType): { width: number; height: number } {
  switch (type) {
    case "TextBox": return { width: 160, height: 28 };
    case "Lamp": return { width: 160, height: 64 };
    case "NumericDisplay": return { width: 160, height: 48 };
    case "AlarmSummary": return { width: 480, height: 200 };
    case "Path": return { width: 96, height: 96 };
    case "Switch": return { width: 120, height: 48 };
    case "N-StateLamp": return { width: 160, height: 48 };
    case "StringDisplay": return { width: 200, height: 36 };
    case "ToggleSwitch": return { width: 140, height: 56 };
    case "BarScale": return { width: 40, height: 160 };
    case "Pipe": return { width: 160, height: 12 };
    case "DateTimeDisplay": return { width: 180, height: 32 };
    case "TrendGraph":
    case "BlockTrend": return { width: 420, height: 220 };
    default: return { width: 200, height: 120 };
  }
}
