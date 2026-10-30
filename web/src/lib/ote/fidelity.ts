/**
 * Does a project survive us? Measured, field by field, on the file itself.
 *
 * A project read from a file is written back two ways and every object of
 * every screen is compared with the one it came from:
 *
 * - edited in place: each object renamed and written back into the project
 *   it was opened from, as an engineer's edit is (a move re-pins a part in
 *   its grid on purpose, so geometry is left to the second write);
 * - moved: the screens written into a project of their own, as a screen that
 *   is copied, duplicated or carried into another project is.
 *
 * A field the file had and the output lacks is a loss. Not counted: for a moved screen, the grid cell a part was pinned
 * to (on a canvas that is its box); and a key whose value was null, which the
 * product reads as absent (lib/ote/schema.ts, withDefaults).
 *
 * scripts/project-check.mts prints this for any file; tests/fidelity.test.ts
 * holds every project in the repository, and the product's templates where
 * they are installed, to zero.
 */

import JSZip from "jszip";
import { readProject, type ReadProject } from "./reader";
import { packageProject } from "./packager";
import type { Screen } from "./schema";

type Json = Record<string, unknown>;

export interface Fidelity {
  read: ReadProject;
  /** Objects on screens the store models, and those carried as they are, by type. */
  modelled: number;
  carried: Record<string, number>;
  /** Lost fields by "Type.path", arrays as []. */
  inPlace: Record<string, number>;
  moved: Record<string, number>;
  /** Why the moved write could not run, when it could not (a project with no screen). */
  movedError?: string;
}

const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const isPart = (v: unknown): v is Json => isObject(v) && typeof v.UniqueId === "string" && typeof v.Type === "string";

/** Every object with a UniqueId on every screen and content screen, by id. */
async function objects(bytes: Uint8Array): Promise<Map<string, Json>> {
  const zip = await JSZip.loadAsync(bytes);
  const found = new Map<string, Json>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isObject(node)) return;
    if (isPart(node)) found.set(String(node.UniqueId).toLowerCase(), node);
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
  };
  for (const f of Object.values(zip.files)) {
    if (!/^(Screens|Contents)\/[^/]+\/Screen\.dat$/i.test(f.name.replace(/\\/g, "/"))) continue;
    const doc = JSON.parse((await f.async("string")).replace(/^﻿/, "")) as Json;
    for (const root of (doc.Children as unknown[]) ?? []) walk((root as Json).Children);
  }
  return found;
}

/** Leaf paths of an object, arrays by position; a nested object with its own id is its own. */
function leaves(o: unknown, at = "", out = new Set<string>()): Set<string> {
  if (Array.isArray(o)) {
    o.forEach((v, i) => leaves(v, `${at}[${i}]`, out));
    if (!o.length) out.add(at);
  } else if (isObject(o)) {
    const entries = Object.entries(o).filter(([, v]) => v !== null);
    if (!entries.length) out.add(at);
    for (const [k, v] of entries) if (!(at && isPart(v))) leaves(v, at ? `${at}.${k}` : k, out);
  } else if (o !== null) out.add(at);
  return out;
}

const EDITED = new Set(["Left", "Top", "Location.Left", "Location.Top"]);
const PINNING = /^(Location|Margin|ObjectAlignment)(\.|$)/;

function compare(before: Map<string, Json>, after: Map<string, Json>, ids: Set<string>, moved: boolean) {
  const lost: Record<string, number> = {};
  for (const id of ids) {
    const a = before.get(id);
    if (!a) continue;
    const b = after.get(id);
    const kept = b ? leaves(b) : new Set<string>();
    for (const p of leaves(a)) {
      if (EDITED.has(p) || kept.has(p) || (moved && PINNING.test(p))) continue;
      const key = `${a.Type}.${p.replace(/\[\d+\]/g, "[]")}`;
      lost[key] = (lost[key] ?? 0) + 1;
    }
  }
  return lost;
}

/** An edit that writes every part back without moving it: a moved part is re-pinned in its grid. */
const touch = (s: Screen): Screen => ({
  ...s,
  Children: [{ ...s.Children[0], Children: s.Children[0].Children.map((p) => ({ ...p, Name: `${p.Name}_` })) }] as Screen["Children"],
});

export const total = (lost: Record<string, number>) => Object.values(lost).reduce((n, v) => n + v, 0);

export async function fidelity(bytes: Uint8Array, fileName = "project.eote"): Promise<Fidelity> {
  const read = await readProject(bytes, fileName);
  const original = await objects(bytes);
  const ids = new Set(read.screens.flatMap((s) => s.Children[0].Children.map((p) => p.UniqueId.toLowerCase())));
  const carried: Record<string, number> = {};
  for (const [id, o] of original) if (!ids.has(id)) carried[String(o.Type)] = (carried[String(o.Type)] ?? 0) + 1;

  const edited = await packageProject({ ...read, screens: read.screens.map(touch) }, undefined, read.preserved);
  const inPlace = compare(original, await objects(edited), ids, false);

  let moved: Record<string, number> = {};
  let movedError: string | undefined;
  try {
    moved = compare(original, await objects(await packageProject(read)), ids, true);
  } catch (e) {
    movedError = (e as Error).message.split("\n")[0];
  }
  return { read, modelled: ids.size, carried, inPlace, moved, movedError };
}
