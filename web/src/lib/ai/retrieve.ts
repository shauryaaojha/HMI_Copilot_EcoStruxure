/**
 * Which tags and objects the model gets to see this turn.
 *
 * A 1,248-tag export does not fit in a prompt and does not need to: a request
 * is about a few units, and the tags that matter are the ones whose names or
 * comments share words with it, the ones bound on the screen being edited,
 * and the ones belonging to any equipment it names. Everything else stays in
 * the store, where the `find_tags` and `find_objects` lookups reach it.
 * docs/LLD.md F6, docs/PLAN_PHASE1.md item 5.
 *
 * Deterministic and cheap, so the same request on the same project gives the
 * same context - which is what makes prompt caching and transcript replay
 * possible. Scoring is plain: a word said outright counts most, a rare word
 * counts more than a common one, a synonym counts less than the word itself,
 * and a prefix ("dosing" against DOS_201) counts a little.
 */

import type { Variable } from "@/lib/ote/schema";

const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "of", "on", "in", "for", "with", "it", "is",
  "add", "put", "make", "show", "screen", "please", "one", "two", "at", "as", "by",
]);

/** Words worth matching: lowercase, three letters or more, or a number. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 || /^\d+$/.test(t))
    .filter((t) => !STOP.has(t));
}

/** A tag name's own words: PMP_101_RUN → pmp, 101, run; also "pmp101". */
function nameTokens(name: string): string[] {
  const parts = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set(parts);
  for (const p of parts) {
    const m = p.match(/^([a-z]+)(\d+)$/);
    if (m) {
      out.add(m[1]);
      out.add(m[2]);
    }
  }
  if (parts.length >= 2) out.add(parts[0] + parts[1]);
  return [...out];
}

/** Common ways an engineer says a role, mapped to the suffixes tags use. */
const SYNONYMS: Record<string, string[]> = {
  running: ["run", "running", "on"],
  run: ["run", "running"],
  fault: ["flt", "fault", "trip", "alm"],
  faults: ["flt", "fault", "trip", "alm"],
  alarm: ["alm", "alarm", "flt", "hi", "hh", "lo", "ll"],
  alarms: ["alm", "alarm", "flt", "hi", "hh", "lo", "ll"],
  high: ["hi", "hh", "high"],
  low: ["lo", "ll", "low"],
  level: ["lvl", "level", "lt", "lit"],
  flow: ["flow", "ft", "fit"],
  pressure: ["prs", "pressure", "pt", "pit"],
  temperature: ["tmp", "temp", "tt", "tit", "temperature"],
  speed: ["spd", "speed"],
  current: ["amps", "cur", "current"],
  pump: ["pmp", "pump"],
  pumps: ["pmp", "pump"],
  valve: ["vlv", "val", "valve"],
  valves: ["vlv", "val", "valve"],
  motor: ["mtr", "mot", "motor"],
  tank: ["tnk", "tk", "tank"],
  fan: ["fan"],
  setpoint: ["sp", "setpoint"],
  start: ["start", "cmd"],
  stop: ["stop", "cmd"],
  dosing: ["dos", "dosing"],
  chemical: ["chem", "chemical"],
};

/** The words a request asks for, and whether each was said or implied. */
function wanted(request: string): Map<string, "said" | "implied"> {
  const out = new Map<string, "said" | "implied">();
  for (const t of tokens(request)) {
    out.set(t, "said");
    for (const s of SYNONYMS[t] ?? []) if (!out.has(s)) out.set(s, "implied");
  }
  return out;
}

/** How rare each word is across a corpus: 1 for everywhere, larger for rare. */
function rarity(corpus: Set<string>[]): (word: string) => number {
  const df = new Map<string, number>();
  for (const own of corpus) for (const w of own) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, corpus.length);
  return (word) => 1 + Math.log(n / ((df.get(word) ?? 0) + 1));
}

function scoreOf(
  own: Set<string>,
  want: Map<string, "said" | "implied">,
  rare: (w: string) => number,
): number {
  let score = 0;
  for (const [w, how] of want) {
    const weight = how === "said" ? 2 : 1;
    if (own.has(w)) {
      score += weight * rare(w);
      continue;
    }
    // "dosing" against "dos", "backwash" against "bw"? Only the first: a word
    // that begins with an own token of three letters or more, or the reverse.
    if (how === "said" && w.length >= 4) {
      for (const t of own) {
        if (t.length >= 3 && (w.startsWith(t) || t.startsWith(w))) {
          score += 0.5 * rare(t);
          break;
        }
      }
    }
  }
  return score;
}

/** Whole-word presence, so "o4" is not found inside "o40". */
const saidOutright = (text: string, word: string) =>
  new RegExp(`(^|[^a-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9_])`, "i").test(text);

export interface RetrieveOptions {
  /** Tags to include regardless of the request - what the active screen binds. */
  pinned?: Iterable<string>;
  limit?: number;
}

/**
 * The tags relevant to a request, most relevant first, capped.
 *
 * Pinned tags come first. Then every tag scored by the words of the request
 * found in its name or comment. Ties keep import order, so the result is
 * stable.
 */
export function relevantTags(
  variables: Variable[],
  request: string,
  options: RetrieveOptions = {},
): Variable[] {
  const limit = options.limit ?? 80;
  const pinned = new Set([...(options.pinned ?? [])].map((t) => t.toLowerCase()));
  const want = wanted(request);
  const owns = variables.map((v) => new Set([...nameTokens(v.Name), ...tokens(v.Comments ?? "")]));
  const rare = rarity(owns);

  const scored = variables.map((v, index) => {
    let score = scoreOf(owns[index], want, rare);
    if (saidOutright(request, v.Name)) score += 50;
    if (pinned.has(v.Name.toLowerCase())) score += 100;
    return { v, score, index };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.v);
}

/** The lookup behind the `find_tags` tool: same scoring, any query. */
export function findTags(variables: Variable[], query: string, limit = 25): Variable[] {
  return relevantTags(variables, query, { limit });
}

/** One object as the lookup tool sees it: no coordinates, ever. */
export interface ObjectEntry {
  handle: string;
  name: string;
  type: string;
  screen: string;
  tag?: string;
}

/** The lookup behind `find_objects`: by words in the name, type or bound tag. */
export function findObjects(objects: ObjectEntry[], query: string, limit = 25): ObjectEntry[] {
  const want = wanted(query);
  const owns = objects.map(
    (o) => new Set([...nameTokens(o.name), o.type.toLowerCase(), ...(o.tag ? nameTokens(o.tag) : [])]),
  );
  const rare = rarity(owns);
  return objects
    .map((o, index) => {
      let score = scoreOf(owns[index], want, rare);
      if (saidOutright(query, o.handle) || saidOutright(query, o.name)) score += 50;
      return { o, score, index };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.o);
}
