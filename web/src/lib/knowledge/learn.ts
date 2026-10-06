/**
 * Scan an opened project into the knowledge base, if one is kept.
 *
 * Called by /api/import on every open. Returns null when the store is off;
 * the caller treats any failure as "not learned" and carries on, because
 * failing to learn from a project must never stop an engineer opening it.
 */

import { scanProject, scanVijeo } from "./scan";
import { sniff } from "@/lib/ingest/sniff";
import { knowledgeStore, putKnowledge } from "./store";

export async function learnFromProject(bytes: Uint8Array, fileName: string): Promise<{ id: string; isNew: boolean } | null> {
  if (knowledgeStore() === "off") return null;
  const kind = await sniff(bytes, fileName);
  const knowledge = kind.kind === "vijeo-designer" && kind.variant === "vdz" ? await scanVijeo(bytes, fileName) : await scanProject(bytes, fileName);
  return putKnowledge(knowledge);
}
