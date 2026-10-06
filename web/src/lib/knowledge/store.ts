/**
 * Where scanned projects are kept.
 *
 * A scan holds a plant's tag names, comments and alarm text: customer
 * engineering data. So the default is the same posture as the rest of the tool
 * (docs/REENGINEERING.md §1.7, local-first): a directory on the engineer's own
 * machine, gitignored, never uploaded. A shared database is used only when
 * someone says so in so many words - a deployment that configured MongoDB for
 * opened files has not thereby agreed to pool every customer's tag list.
 *
 *   KNOWLEDGE_STORE=filesystem   .knowledge/<sha256>.json   (default without MongoDB)
 *   KNOWLEDGE_STORE=mongo        the "knowledge" collection  (opt-in only)
 *   KNOWLEDGE_STORE=off          nothing is kept            (default with MongoDB)
 *   KNOWLEDGE_DIR=<path>         where the filesystem store lives
 *
 * Records are keyed by the file's sha256, so opening the same project twice
 * is one record, and deleting one is deleting everything kept about it.
 */

import type { ProjectKnowledge } from "./scan";
import { hasMongo, mongoDb } from "@/lib/db/mongo";

export type KnowledgeStoreKind = "filesystem" | "mongo" | "off";

export const KNOWLEDGE_DIR = ".knowledge";

export function knowledgeStore(): KnowledgeStoreKind {
  const asked = process.env.KNOWLEDGE_STORE?.trim().toLowerCase();
  if (asked === "off" || asked === "filesystem") return asked;
  if (asked === "mongo") return hasMongo() ? "mongo" : "filesystem";
  return hasMongo() ? "off" : "filesystem";
}

/** One line per record, for listings: everything but the bulk. */
export interface KnowledgeSummary {
  id: string;
  fileName: string;
  scannedAt: string;
  product: string;
  layout: string;
  target: ProjectKnowledge["target"];
  counts: ProjectKnowledge["counts"];
  equipmentKinds: Record<string, number>;
  problems: number;
}

export const summarise = (k: ProjectKnowledge): KnowledgeSummary => ({
  id: k.id,
  fileName: k.fileName,
  scannedAt: k.scannedAt,
  product: k.source.product,
  layout: k.source.layout,
  target: k.target,
  counts: k.counts,
  equipmentKinds: k.equipment.reduce<Record<string, number>>((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {}),
  problems: k.problems.length,
});

const validId = (id: string) => /^[0-9a-f]{64}$/.test(id);

async function dir() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  // KNOWLEDGE_DIR points the store somewhere else: a shared drive for a team
  // library, or a temporary directory in the tests.
  const d = process.env.KNOWLEDGE_DIR?.trim() || path.join(process.cwd(), KNOWLEDGE_DIR);
  await fs.mkdir(d, { recursive: true });
  return { fs, path, d };
}

async function collection() {
  const c = (await mongoDb()).collection<ProjectKnowledge & { _id: string }>("knowledge");
  return c;
}

/** Keep a record. Returns whether it was new. Throws when the store is off. */
export async function putKnowledge(k: ProjectKnowledge): Promise<{ id: string; isNew: boolean }> {
  const store = knowledgeStore();
  if (store === "off") throw new Error("the knowledge store is off (KNOWLEDGE_STORE)");
  if (store === "filesystem") {
    const { fs, path, d } = await dir();
    const file = path.join(d, `${k.id}.json`);
    const existed = await fs.stat(file).then(() => true, () => false);
    // Write to a temporary name and rename, so a crash mid-write never leaves
    // a half record that breaks every later aggregate.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(k));
    await fs.rename(tmp, file);
    return { id: k.id, isNew: !existed };
  }
  const c = await collection();
  const r = await c.replaceOne({ _id: k.id }, k, { upsert: true });
  return { id: k.id, isNew: r.upsertedCount === 1 };
}

export async function getKnowledge(id: string): Promise<ProjectKnowledge | null> {
  if (!validId(id)) return null;
  const store = knowledgeStore();
  if (store === "off") return null;
  if (store === "filesystem") {
    const { fs, path, d } = await dir();
    const text = await fs.readFile(path.join(d, `${id}.json`), "utf-8").catch(() => null);
    if (!text) return null;
    try {
      return JSON.parse(text) as ProjectKnowledge;
    } catch {
      return null;
    }
  }
  const found = await (await collection()).findOne({ _id: id });
  if (!found) return null;
  const { _id, ...rest } = found;
  void _id;
  return rest as ProjectKnowledge;
}

/** Every record. A damaged file is skipped, never fatal. */
export async function allKnowledge(): Promise<ProjectKnowledge[]> {
  const store = knowledgeStore();
  if (store === "off") return [];
  if (store === "filesystem") {
    const { fs, path, d } = await dir();
    const names = (await fs.readdir(d)).filter((n) => /^[0-9a-f]{64}\.json$/.test(n));
    const out: ProjectKnowledge[] = [];
    for (const n of names) {
      try {
        out.push(JSON.parse(await fs.readFile(path.join(d, n), "utf-8")) as ProjectKnowledge);
      } catch {
        // A half-written or hand-edited record: leave it, aggregate the rest.
      }
    }
    return out.sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
  }
  const docs = await (await collection()).find({}).sort({ scannedAt: 1 }).toArray();
  return docs.map(({ _id, ...rest }) => (void _id, rest as ProjectKnowledge));
}

export async function deleteKnowledge(id: string): Promise<boolean> {
  if (!validId(id)) return false;
  const store = knowledgeStore();
  if (store === "off") return false;
  if (store === "filesystem") {
    const { fs, path, d } = await dir();
    return fs.unlink(path.join(d, `${id}.json`)).then(() => true, () => false);
  }
  const r = await (await collection()).deleteOne({ _id: id });
  return r.deletedCount === 1;
}
