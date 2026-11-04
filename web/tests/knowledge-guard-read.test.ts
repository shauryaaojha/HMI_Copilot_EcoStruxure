/**
 * S3-08, merged into S2-06 (docs/audit/BUGS.md), moved from web/scripts/audit/ with the fix: /api/knowledge reads and deletes the knowledge base for anyone.
 *
 * src/app/api/knowledge/route.ts has no caller check on GET, POST or DELETE (lines 26, 40, 69).
 * A scan holds a plant's tag names, comments and alarm text (lib/knowledge/store.ts:4).
 * With KNOWLEDGE_STORE=filesystem (the default without Mongo) or =mongo (opt-in, and then
 * anonymous imports feed it: lib/knowledge/privacy.ts:9), an anonymous request can list every
 * record, read any one in full, or delete it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/session", () => ({ currentUser: async () => null }));
import { DELETE, GET } from "@/app/api/knowledge/route";
import { getKnowledge, putKnowledge } from "@/lib/knowledge/store";
import type { ProjectKnowledge } from "@/lib/knowledge/scan";

const ID = "a".repeat(64);

beforeEach(async () => {
  vi.stubEnv("MONGODB_URI", "");
  vi.stubEnv("KNOWLEDGE_STORE", "filesystem");
  vi.stubEnv("KNOWLEDGE_DIR", mkdtempSync(path.join(tmpdir(), "s3-knowledge-")));
  await putKnowledge({ id: ID, fileName: "customer.eote", scannedAt: new Date().toISOString(), variables: [{ name: "SECRET_TAG" }] } as unknown as ProjectKnowledge);
});

describe("S3-08 the knowledge base is not open to anonymous callers", () => {
  it("anonymous GET ?id= does not return a customer's scan", async () => {
    const r = await GET(new Request(`https://hmi.example.com/api/knowledge?id=${ID}`));
    const body = await r.text();
    expect(r.status === 200 && body.includes("SECRET_TAG"), `anonymous GET answered ${r.status} with the scan's tag names`).toBe(false);
  });

  it("anonymous DELETE does not remove a record", async () => {
    const r = await DELETE(new Request(`https://hmi.example.com/api/knowledge?id=${ID}`, { method: "DELETE" }));
    expect(await getKnowledge(ID), `anonymous DELETE answered ${r.status} and the record is gone`).not.toBeNull();
  });
});
