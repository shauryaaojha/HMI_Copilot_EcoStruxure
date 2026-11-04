/**
 * S5-05: /api/knowledge has no session check (src/app/api/knowledge/route.ts:26-37
 * GET, :40-66 POST, :68 DELETE). Wherever the store is on (filesystem is the
 * default without MongoDB, store.ts:27-32; "mongo" on request), anyone who can
 * reach the server reads every scanned project's tag names, comments and alarm
 * text (scan.ts KnownVariable/KnownAlarm), adds records, and deletes them.
 * Production answers GET with store "off" today (measured 2026-11-04), so this
 * is latent there and live on any self-hosted or local deployment.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { putKnowledge } from "@/lib/knowledge/store";
import type { ProjectKnowledge } from "@/lib/knowledge/scan";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s5-knowledge-"));
const id = "a".repeat(64);
const saved = { store: process.env.KNOWLEDGE_STORE, dir: process.env.KNOWLEDGE_DIR, mongo: process.env.MONGODB_URI };

beforeAll(async () => {
  process.env.KNOWLEDGE_STORE = "filesystem";
  process.env.KNOWLEDGE_DIR = dir;
  delete process.env.MONGODB_URI;
  await putKnowledge({
    v: 1, id, fileName: "client.eote", scannedAt: new Date().toISOString(),
    source: { product: "OTE", layout: "typed" }, target: null,
    counts: { entries: 0, screens: 0, contentScreens: 0, objects: 0, variables: 1, alarms: 1, alarmGroups: 0, bindings: 0 },
    screens: [], partTypes: {}, variables: [{ name: "SECRET_TAG", dataType: "BOOL", comment: "plant detail", address: "" }],
    bindings: [], alarms: [{ group: "", message: "plant alarm text", level: "", kind: "bit" }],
    naming: { separators: {}, cases: {}, prefixes: {}, suffixes: {}, numbered: 0, averageLength: 0 }, equipment: [], tables: {}, problems: [],
  } as ProjectKnowledge);
});
afterAll(() => {
  process.env.KNOWLEDGE_STORE = saved.store;
  process.env.KNOWLEDGE_DIR = saved.dir;
  if (saved.mongo !== undefined) process.env.MONGODB_URI = saved.mongo;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("S5-05 /api/knowledge without a session", () => {
  it("refuses to hand a scanned project to an anonymous caller", async () => {
    const { GET } = await import("@/app/api/knowledge/route");
    const res = await GET(new Request(`http://localhost/api/knowledge?id=${id}`));
    const body = await res.text();
    expect(res.status, `anonymous GET answered ${res.status}: ${body.slice(0, 120)}`).toBe(401);
  });

  it("refuses an anonymous delete", async () => {
    const { DELETE } = await import("@/app/api/knowledge/route");
    const res = await DELETE(new Request(`http://localhost/api/knowledge?id=${id}`, { method: "DELETE" }));
    expect(res.status, `anonymous DELETE answered ${res.status}; record still on disk: ${fs.existsSync(path.join(dir, `${id}.json`))}`).toBe(401);
  });
});
