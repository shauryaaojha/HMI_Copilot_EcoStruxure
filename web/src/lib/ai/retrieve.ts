/**
 * Which tags the model gets to see this turn.
 *
 * A 1,248-tag export does not fit in a prompt and does not need to: a request
 * is about a few units, and the tags that matter are the ones whose names or
 * comments share words with it, the ones bound on the screen being edited,
 * and the ones belonging to any equipment it names. Everything else stays in
 * the store, where `find_tags` can reach it later. docs/LLD.md F6.
 *
 * Deterministic and cheap, so the same request on the same project gives the
 * same context - which is what makes prompt caching and transcript replay
 * possible.
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
};

export interface RetrieveOptions {
  /** Tags to include regardless of the request - what the active screen binds. */
  pinned?: Iterable<string>;
  limit?: number;
}

/**
 * The tags relevant to a request, most relevant first, capped.
 *
 * Pinned tags come first. Then every tag scored by how many of the request's
 * words appear in its name or comment, with the synonyms above so "running"
 * finds `_RUN`. Ties keep import order, so the result is stable.
 */
export function relevantTags(
  variables: Variable[],
  request: string,
  options: RetrieveOptions = {},
): Variable[] {
  const limit = options.limit ?? 80;
  const pinned = new Set([...(options.pinned ?? [])].map((t) => t.toLowerCase()));

  const wanted = new Set<string>();
  for (const t of tokens(request)) {
    wanted.add(t);
    for (const s of SYNONYMS[t] ?? []) wanted.add(s);
  }

  const scored = variables.map((v, index) => {
    const own = new Set([...nameTokens(v.Name), ...tokens(v.Comments ?? "")]);
    let score = 0;
    for (const w of wanted) if (own.has(w)) score++;
    // A request that names the tag outright always wins.
    if (request.toLowerCase().includes(v.Name.toLowerCase())) score += 10;
    if (pinned.has(v.Name.toLowerCase())) score += 100;
    return { v, score, index };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.v);
}

/** The lookup behind a `find_tags` tool: same scoring, any query. */
export function findTags(variables: Variable[], query: string, limit = 25): Variable[] {
  return relevantTags(variables, query, { limit });
}
