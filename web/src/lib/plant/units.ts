/**
 * Engineering units and ranges, read from what a tag comment says.
 *
 * A comment is where a PLC export keeps the unit ("Reactor 1 temperature
 * (degC)") and sometimes the range ("0-150 degC"). Both are read here, once,
 * for the Plant Model and the layout. What the comment does not say comes
 * from the class default and is marked as such, so the engineer sees an
 * assumption rather than a fact.
 */

export function unitOf(comment: string, role: string): string {
  if (/percent|%/i.test(comment)) return "%";
  if (/lpm|l\/min/i.test(comment)) return "LPM";
  if (/m3\/h|m³\/h/i.test(comment)) return "m3/h";
  if (/\bbar\b/i.test(comment)) return "bar";
  if (/\bpsi\b/i.test(comment)) return "psi";
  if (/deg\s?c|°c|celsius/i.test(comment)) return "degC";
  if (/\bkw\b/i.test(comment)) return "kW";
  if (/\brpm\b/i.test(comment)) return "rpm";
  if (/\bhz\b|hertz/i.test(comment)) return "Hz";
  if (/\bm3\b/i.test(comment)) return "m3";
  if (/\bkg\b/i.test(comment)) return "kg";
  if (/\bmm\b/i.test(comment)) return "mm";
  if (/\bhours?\b|\bhrs\b|\brun ?time\b/i.test(comment) || role === "hours") return "h";
  if (/\bamps?\b|\bcurrent\b/i.test(comment) || role === "current") return "A";
  if (role === "level") return "%";
  if (role === "flow") return "LPM";
  if (role === "speed") return "%";
  if (role === "position") return "%";
  if (role === "volume") return "m3";
  return "";
}

export interface Range {
  min: number;
  max: number;
  normalLow: number;
  normalHigh: number;
  units: string;
  /** Where the numbers came from: the export, the class default, or the engineer. */
  source: "export" | "class" | "engineer";
}

/** "0-150", "0..150", "0 to 150" in a comment, when an export bothers to say. */
export function rangeInComment(comment: string): { min: number; max: number } | null {
  const m = comment.match(/(-?\d+(?:\.\d+)?)\s*(?:-|\.\.|to)\s*(-?\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max };
}

/** The class default for a unit of measure, with a normal band inside it. */
export function defaultRange(units: string, role: string): Omit<Range, "source"> {
  const band = (min: number, max: number, lo: number, hi: number) => ({ min, max, normalLow: lo, normalHigh: hi, units });
  switch (units) {
    case "%":
      return role === "level" ? band(0, 100, 30, 80) : band(0, 100, 20, 90);
    case "bar":
      return band(0, 10, 2, 8);
    case "psi":
      return band(0, 150, 30, 120);
    case "degC":
      return band(0, 150, 20, 120);
    case "rpm":
      return band(0, 3000, 600, 2800);
    case "Hz":
      return band(0, 60, 10, 55);
    case "kW":
      return band(0, 100, 5, 90);
    case "m3/h":
    case "LPM":
      return band(0, 100, 20, 90);
    case "m3":
      return band(0, 1000, 100, 900);
    case "h":
      return band(0, 100000, 0, 100000);
    case "A":
      return band(0, 100, 5, 90);
    default:
      return band(0, 100, 20, 80);
  }
}

/** The range for a reading: the comment's numbers if it has them, else the class's. */
export function rangeFor(comment: string, role: string): Range {
  const units = unitOf(comment, role);
  const stated = rangeInComment(comment);
  const base = defaultRange(units, role);
  if (!stated) return { ...base, source: "class" };
  const span = stated.max - stated.min;
  return {
    min: stated.min,
    max: stated.max,
    normalLow: stated.min + span * 0.2,
    normalHigh: stated.min + span * 0.9,
    units,
    source: "export",
  };
}
