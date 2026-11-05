import type { Entry, Kb, Kind } from "./types";

const PUBLIC = new Set(["code", "docs", "components"]);
export type KbCaller = "chat" | "agent" | "mcp";

/** Raw scans are not entries and cannot pass through this serializer. */
export function canServe(entry: Entry, caller: KbCaller): boolean {
  void caller;
  return PUBLIC.has(entry.layer);
}

export function searchEntries(kb: Kb, q: string, caller: KbCaller, opts: { kinds?: Kind[]; tags?: string[] } = {}) {
  return kb.search(q, opts).filter(({ entry }) => canServe(entry, caller)).slice(0, 8)
    .map(({ entry, score }) => ({ id: entry.id, title: entry.title, summary: entry.summary, score }));
}

export function getEntry(kb: Kb, id: string, caller: KbCaller) {
  const entry = kb.get(id);
  if (!entry || !canServe(entry, caller)) return undefined;
  const body = JSON.stringify(entry.body);
  return { id: entry.id, title: entry.title, summary: entry.summary, body: body.length <= 2048 ? entry.body : `${body.slice(0, 2048)}…`, source: entry.source, rev: entry.rev };
}
