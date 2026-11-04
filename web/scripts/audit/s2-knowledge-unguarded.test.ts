/**
 * S2-06: /api/knowledge reads, adds to and deletes from the knowledge base
 * with no identity and no Origin check (src/app/api/knowledge/route.ts:26-77).
 * On a laptop (store "filesystem", the default without MongoDB) any web page
 * the engineer visits can POST a project into the corpus the model is fed
 * (a no-cors fetch with a Blob body needs no preflight), and with
 * KNOWLEDGE_STORE=mongo on a deployment anyone can list, poison or delete it.
 * Production answers store "off" today (GET /api/knowledge, read-only).
 */
import { expect, it, vi } from "vitest";

const deleted = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/knowledge/store", () => ({
  knowledgeStore: () => "filesystem",
  allKnowledge: async () => [],
  getKnowledge: async () => null,
  putKnowledge: async () => ({ id: "x", isNew: true }),
  summarise: () => ({}),
  deleteKnowledge: async (id: string) => { deleted.push(id); return true; },
}));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => null }));

import { DELETE } from "@/app/api/knowledge/route";

it("refuses a cross-origin, signed-out delete", async () => {
  const response = await DELETE(new Request("http://localhost:3000/api/knowledge?id=abc", { method: "DELETE", headers: { Origin: "https://attacker.invalid" } }));
  expect({ status: response.status, deleted: [...deleted] }, "a foreign origin with no session deleted a knowledge record").toEqual({ status: 403, deleted: [] });
});
