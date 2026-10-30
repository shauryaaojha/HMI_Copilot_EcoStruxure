/**
 * What finished projects have to say about a brief, fetched.
 *
 * ./suggest.ts is the judgement and this is the errand: read the knowledge
 * base, hand it the brief, return what came back. They are apart because the
 * judgement is worth testing against records written by hand, and reading a
 * store is not.
 *
 * A store that is off, or empty, costs a draft nothing: `allKnowledge()`
 * answers with an empty array without touching a disk or a collection when
 * `knowledgeStore()` is "off", which is the default on a deployment with Mongo
 * and no KNOWLEDGE_STORE set (lib/knowledge/store.ts). So this can sit on the
 * drafting path unconditionally rather than behind a flag the caller has to
 * remember.
 *
 * Nothing here can widen a brief. That guarantee lives in `suggestSignals`,
 * which only ever speaks about units the brief already has and signals the
 * kind's own catalogue allows; this function adds no path around it.
 */

import { allKnowledge } from "@/lib/knowledge/store";
import type { Brief } from "./brief";
import { suggestSignals, type SignalSuggestion } from "./suggest";

/**
 * The most records to weigh. Evidence is counted per project, so a hundred
 * would not say much more than twenty, and a draft is a request someone is
 * waiting on.
 */
const MOST = 40;

/** Suggestions for this brief, or none. Never throws: a draft outranks advice. */
export async function suggestionsFor(brief: Brief): Promise<SignalSuggestion[]> {
  if (brief.units.length === 0) return [];
  try {
    const records = await allKnowledge();
    if (records.length === 0) return [];
    // The newest, because a convention that changed is better evidence than
    // the one it replaced; allKnowledge sorts oldest first.
    return suggestSignals(brief, records.slice(-MOST));
  } catch {
    // A knowledge base that cannot be read is a knowledge base with nothing to
    // say. The brief is the engineer's work and does not wait on it.
    return [];
  }
}
