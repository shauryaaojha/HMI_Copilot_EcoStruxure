/**
 * What each equipment class is about: the readings it leads with.
 *
 * This is class knowledge, not screen knowledge, so it sits with the Plant
 * Model rather than with the screen architect - the model reads it to work out
 * what a bare `_PV` measures, the architect reads it to choose a headline, and
 * the critic reads it to check that the two agree. docs/PLAN_PHASE4.md §3.
 *
 * The order inside each class is the order an engineer would put on a
 * faceplate: what the machine is for first.
 */

export const HEADLINE_BY_CLASS: Record<string, string[]> = {
  tank: ["level", "volume", "temperature", "pressure"],
  reactor: ["temperature", "pressure", "level"],
  boiler: ["pressure", "temperature", "level"],
  pump: ["flow", "speed", "pressure", "current", "hours"],
  doser: ["flow", "speed"],
  compressor: ["pressure", "speed"],
  fan: ["speed", "flow", "pressure"],
  conveyor: ["speed"],
  valve: ["position", "flow"],
  filter: ["pressure", "flow"],
  heater: ["temperature"],
  chiller: ["temperature"],
  motor: ["speed", "current", "power"],
};

/**
 * What a class leads with, for the architect to choose a headline and the
 * critic to check one. Empty for a class the table does not know, which is not
 * a finding - it is a class nobody has stated a preference for.
 */
export const headlineRolesFor = (klass: string): string[] => HEADLINE_BY_CLASS[klass] ?? [];

/**
 * What a bare process-variable tag on this class measures. `VLV_202_PV` is a
 * valve's position and `TNK_101_PV` is a tank's level; read as the generic
 * "value" they both end up on a screen labelled "Value" with no unit and no
 * range, which is what the critic caught as a pump labelled with the wrong
 * reading. Undefined when the class does not say, and then "value" stands.
 */
export const measuredByClass = (klass: string): string | undefined => HEADLINE_BY_CLASS[klass]?.[0];

/**
 * A unit's readings in the order a screen should show them: the tags the
 * engineer asked for first, in the order they asked, then what the class leads
 * with, then the rest as declared.
 *
 * One ordering for every place a reading is chosen - the faceplate card, the
 * process callout, the overview KPI - so the card and the process view cannot
 * lead with different readings for the same pump, and the engineer's sentence
 * outranks the class table everywhere at once.
 */
export function orderReadings<R extends { tag: string; role: string }>(
  readings: R[],
  klass: string,
  preferred: readonly string[] = [],
): R[] {
  const asked = (r: R) => {
    const i = preferred.indexOf(r.tag);
    return i === -1 ? Infinity : i;
  };
  const lead = headlineRolesFor(klass);
  const byClass = (r: R) => {
    const i = lead.indexOf(r.role);
    return i === -1 ? Infinity : i;
  };
  return readings
    .map((r, i) => ({ r, i }))
    .sort((a, b) => asked(a.r) - asked(b.r) || byClass(a.r) - byClass(b.r) || a.i - b.i)
    .map(({ r }) => r);
}
