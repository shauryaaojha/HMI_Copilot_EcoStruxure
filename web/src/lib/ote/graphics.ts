/**
 * The product ships 475 graphic objects at
 *   Buildtime/PropertyDefinitions/ScreenDesign/GraphicObjects/**\/*.path
 * organised into Pumps, Tanks, Valves, Pipes, Fans, Arrows and more.
 *
 * Each is JSON of the form
 *   { "Name": "Pump01", "Commands": "MLLLLLLLLLLz…", "Points": "0,2502,166,2502,…" }
 *
 * Commands is an SVG-style command string; Points is the flat coordinate list those
 * commands consume, in order. Zipping the two produces an SVG path `d` directly, so
 * the browser canvas draws the identical geometry the generated project contains -
 * which is what keeps the preview honest while still looking like the mockups.
 *
 * Phase 2b of docs/BUILD_PLAN.md.
 */

/** How many points each command consumes. */
const ARITY: Record<string, number> = {
  M: 1, // moveto
  L: 1, // lineto
  Q: 2, // quadratic bezier
  C: 3, // cubic bezier
  z: 0, // closepath
  Z: 0,
};

export interface GraphicObject {
  /** e.g. "Pump01" */
  name: string;
  /** e.g. "03-Icons/Pumps" */
  category: string;
  /** SVG path data, derived - what the canvas draws */
  d: string;
  /** natural bounds of the geometry, for the SVG viewBox */
  width: number;
  height: number;
  /**
   * The two fields exactly as the .path file carries them.
   *
   * `d` is derived from these and is not a substitute: a Path part stores
   * Commands and Points, so an index that keeps only the derived form can be
   * browsed but never placed. Keep both - the canvas draws from `d`, the
   * packager writes from these.
   */
  Commands: string;
  Points: string;
}

export interface RawPathFile {
  Name: string;
  Commands: string;
  Points: string;
}

/**
 * What the converters actually need. `Name` only ever appears in an error
 * message, so requiring it would stop an indexed GraphicObject - which has a
 * lowercase `name` - being passed straight back in to check it still converts.
 */
export type PathGeometry = {
  Commands: string;
  Points: string;
  Name?: string;
};

/**
 * Turns a .path file's Commands + Points into an SVG `d` attribute.
 * Throws rather than guessing if the two disagree - a silently truncated symbol
 * would be worse than a loud failure.
 */
export function toPathData(raw: PathGeometry): string {
  const nums = raw.Points.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);

  if (nums.some(Number.isNaN)) {
    throw new Error(`${raw.Name ?? "path"}: non-numeric value in Points`);
  }
  if (nums.length % 2 !== 0) {
    throw new Error(`${raw.Name ?? "path"}: odd number of coordinates`);
  }

  const out: string[] = [];
  let i = 0; // index into nums, stepping by 2

  for (const command of raw.Commands) {
    const arity = ARITY[command];
    if (arity === undefined) {
      throw new Error(`${raw.Name ?? "path"}: unsupported path command "${command}"`);
    }
    if (arity === 0) {
      out.push("Z");
      continue;
    }
    const needed = arity * 2;
    if (i + needed > nums.length) {
      throw new Error(
        `${raw.Name ?? "path"}: "${command}" needs ${arity} point(s) but Points is exhausted`,
      );
    }
    const coords: string[] = [];
    for (let k = 0; k < needed; k += 2) {
      coords.push(`${nums[i + k]},${nums[i + k + 1]}`);
    }
    i += needed;
    out.push(`${command} ${coords.join(" ")}`);
  }

  if (i !== nums.length) {
    throw new Error(
      `${raw.Name ?? "path"}: ${(nums.length - i) / 2} unused point(s) after the last command`,
    );
  }

  return out.join(" ");
}

/** Natural bounds of the geometry, so the symbol can be scaled into any box. */
export function boundsOf(raw: PathGeometry): { width: number; height: number } {
  const nums = raw.Points.split(",").map(Number);
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (nums[i] > maxX) maxX = nums[i];
    if (nums[i + 1] > maxY) maxY = nums[i + 1];
  }
  return { width: maxX, height: maxY };
}

export function toGraphicObject(
  raw: RawPathFile,
  category: string,
): GraphicObject {
  const { width, height } = boundsOf(raw);
  return {
    name: raw.Name,
    category,
    d: toPathData(raw),
    width,
    height,
    Commands: raw.Commands,
    Points: raw.Points,
  };
}
