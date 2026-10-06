/**
 * Scan an opened project into the knowledge base, if one is kept.
 *
 * Called by /api/import on every open. Returns null when the store is off;
 * the caller treats any failure as "not learned" and carries on, because
 * failing to learn from a project must never stop an engineer opening it.
 */

import { scanProject } from "./scan";
import { knowledgeStore, putKnowledge } from "./store";

export async function learnFromProject(bytes: Uint8Array, fileName: string): Promise<{ id: string; isNew: boolean } | null> {
  if (knowledgeStore() === "off") return null;
  const knowledge = await scanProject(bytes, fileName);
  return putKnowledge(knowledge);
}
