/**
 * Scale converters: how a reading in engineering units becomes a fill.
 *
 * A Rectangle's Animation.FillLevel takes a percentage, 0-100 - the product's
 * own help says so (featureguide/property/Properties_(Rectangle).htm, "Set the
 * percentage for the object's vertical fill ... 0 - 100"). A level in metres or
 * a pressure in bar is not one. The product's documented way to draw a bar
 * from a variable (featureguide/bar_metergraph/fs01.htm) is a Scale converter
 * on the binding: Minimum and Maximum (Source) to Minimum and Maximum
 * (Output), 0 and 100.
 *
 * A converter is a row in Converters.db - UniqueId, Name, Order, ConverterType
 * and the definition as JSON in Data - and a binding names it by ConverterId
 * and ConverterName. Both shapes were read from real files in the template
 * corpus (six Scale converters, e.g. GPS_Slider01's {"Type":"Converter",
 * "SubType":"Scale", ..., "FromMax":1000, "ToMax":410}); every field written
 * here is one of those. FromMin is written explicitly: the corpus omits it
 * when it is 0, which says the key exists and defaults to 0.
 */

import type { Database } from "sql.js";
import { gid } from "./parts";

/** A linear map from a reading's range onto what the bound property takes. */
export interface Scale {
  min: number;
  max: number;
  /** The output range; a fill's 0-100 when absent. */
  toMin?: number;
  toMax?: number;
  /** Set when the converter was read from a file, so it is written back as itself. */
  id?: string;
  name?: string;
}

const num = (n: number) => String(n).replace("-", "m").replace(".", "p");

/** One converter per range, shared by every bar on that range. */
export const scaleName = (s: Scale) =>
  s.name ?? `HMIC_Scale_${num(s.min)}_${num(s.max)}${s.toMin !== undefined || s.toMax !== undefined ? `_to_${num(s.toMin ?? 0)}_${num(s.toMax ?? 100)}` : ""}`;

/** What a value becomes on the way through: the same arithmetic the runtime applies. */
export function applyScale(s: Scale, value: number): number {
  const toMin = s.toMin ?? 0;
  const toMax = s.toMax ?? 100;
  const span = s.max - s.min;
  if (span === 0) return toMin;
  const out = toMin + ((value - s.min) / span) * (toMax - toMin);
  return Math.min(Math.max(out, Math.min(toMin, toMax)), Math.max(toMin, toMax));
}

/**
 * Makes sure every scale has a row, and returns the id each name resolves to.
 *
 * A row already there by name is reused, never rewritten: a converter the
 * engineer set up in the product is theirs. A scale read from a file keeps the
 * id it was read with.
 */
export function syncConverters(db: Database, scales: Scale[]): { ids: Record<string, string>; inserted: number } {
  const ids: Record<string, string> = {};
  let inserted = 0;
  const byName = new Map<string, string>();
  for (const row of db.exec('SELECT "UniqueId", "Name" FROM Converters')[0]?.values ?? []) {
    byName.set(String(row[1]), String(row[0]));
  }
  const maxOrder = db.exec('SELECT MAX("Order") FROM Converters')[0]?.values[0]?.[0];
  let order = typeof maxOrder === "number" ? maxOrder : 0;

  for (const scale of scales) {
    const name = scaleName(scale);
    if (ids[name]) continue;
    const existing = byName.get(name);
    if (existing) {
      ids[name] = existing;
      continue;
    }
    const id = scale.id ?? gid();
    order += 1;
    const data = {
      Type: "Converter",
      SubType: "Scale",
      UniqueId: id,
      Name: name,
      Order: order,
      DecimalPlaces: 0,
      FromMin: scale.min,
      FromMax: scale.max,
      ToMin: scale.toMin ?? 0,
      ToMax: scale.toMax ?? 100,
    };
    db.run('INSERT INTO Converters ("UniqueId", "Name", "Order", "ConverterType", "Description", "Data") VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      name,
      order,
      "Scale",
      null,
      JSON.stringify(data),
    ]);
    byName.set(name, id);
    ids[name] = id;
    inserted += 1;
  }
  return { ids, inserted };
}

/** Scale converters in a Converters.db, by id (lower case), as the reader models them. */
export function readScales(db: Database): Map<string, Scale> {
  const out = new Map<string, Scale>();
  let rows: unknown[][] = [];
  try {
    rows = db.exec('SELECT "UniqueId", "Name", "ConverterType", "Data" FROM Converters')[0]?.values ?? [];
  } catch {
    return out;
  }
  for (const [id, name, type, data] of rows) {
    if (type !== "Scale" || typeof data !== "string") continue;
    try {
      const d = JSON.parse(data) as Record<string, unknown>;
      const n = (k: string, fallback: number) => (typeof d[k] === "number" ? (d[k] as number) : fallback);
      out.set(String(id).toLowerCase(), {
        id: String(id),
        name: String(name),
        min: n("FromMin", 0),
        max: n("FromMax", 100),
        toMin: n("ToMin", 0),
        toMax: n("ToMax", 100),
      });
    } catch {
      // A definition we cannot read stays a binding we do not model.
    }
  }
  return out;
}
