import code from "./generated/code.json";
import { curatedEntries } from "./curated";
import { queryTerms, termsOf } from "./search";
import type { Entry, Kb, Kind } from "./types";

export function makeKb(entries: readonly Entry[], codeVersion = "test"): Kb {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (byId.size !== entries.length) throw new Error("duplicate knowledge entry id");
  const byTag = new Map<string, Set<string>>();
  const terms = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    for (const tag of entry.tags) (byTag.get(tag) ?? byTag.set(tag, new Set()).get(tag)!).add(entry.id);
    for (const [term, weight] of termsOf(entry)) (terms.get(term) ?? terms.set(term, new Map()).get(term)!).set(entry.id, weight);
  }
  const get = (id: string) => byId.get(id);
  return {
    version: { schema: 1, code: codeVersion }, get,
    byTag(tag, opts = {}) {
      return [...(byTag.get(tag.toLowerCase()) ?? [])].map((id) => get(id)!).filter((entry) => !opts.kind || entry.kind === opts.kind).slice(0, opts.limit ?? 50);
    },
    search(q, opts = {}) {
      const scores = new Map<string, number>();
      for (const term of queryTerms(q)) {
        for (const [id, weight] of terms.get(term) ?? []) scores.set(id, (scores.get(id) ?? 0) + weight);
      }
      // A request for a reading needs a concrete value display before a layout pattern.
      if (queryTerms(q).includes("reading")) for (const [id, score] of scores) {
        const entry = get(id)!;
        if (entry.kind === "partType" && entry.tags.includes("reading")) scores.set(id, score + 15);
      }
      return [...scores].map(([id, score]) => ({ entry: get(id)!, score }))
        .filter(({ entry }) => (!opts.kinds || opts.kinds.includes(entry.kind)) && (!opts.tags || opts.tags.every((tag) => entry.tags.includes(tag))))
        .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, Math.min(opts.limit ?? 8, 8));
    },
    related(id, depth = 1) {
      const seen = new Set([id]);
      let wave = [id];
      for (let n = 0; n < depth; n++) {
        wave = wave.flatMap((key) => get(key)?.related ?? []).filter((key) => !seen.has(key) && !!get(key));
        wave.forEach((key) => seen.add(key));
      }
      return [...seen].filter((key) => key !== id).map((key) => get(key)!);
    },
  };
}

let current: Kb | undefined;
export const codeKb = (): Kb => current ??= makeKb([...(code.entries as Entry[]), ...curatedEntries], code.version);
export const loadKb = (): Kb | undefined => {
  try { return codeKb(); } catch { return undefined; }
};
export type { Entry, Kb, Kind };
