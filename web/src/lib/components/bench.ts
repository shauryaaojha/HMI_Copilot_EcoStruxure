import type { PartType } from "@/lib/ote/schema";

/** Part types already used in a generator project that opened in OTE 4.4. */
export const BENCHED_PARTS = [
  "Rectangle", "TextBox", "Lamp", "NumericDisplay", "Switch", "N-StateLamp",
  "StringDisplay", "ToggleSwitch", "BarScale", "Pipe", "DateTimeDisplay",
  "TrendGraph", "BlockTrend", "AlarmSummary", "Path",
] as const satisfies readonly PartType[];

export function assertBenched(parts: readonly { Type: string }[]): void {
  const allowed: readonly string[] = BENCHED_PARTS;
  const unbenched = parts.find((part) => !allowed.includes(part.Type));
  if (unbenched) throw new Error(`${unbenched.Type} has not been benched in OTE 4.4`);
}
