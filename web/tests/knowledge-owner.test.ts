import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProjectKnowledge } from "@/lib/knowledge/scan";

const identity = vi.hoisted(() => ({ id: "owner-a" }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => ({ id: identity.id, name: "Engineer" }) }));
import { DELETE, GET } from "@/app/api/knowledge/route";
import { getKnowledge, ownScan, putKnowledge } from "@/lib/knowledge/store";

const A = "a".repeat(64);
const B = "b".repeat(64);
const request = (id?: string, method = "GET") => new Request(`http://localhost:3000/api/knowledge${id ? `?id=${id}` : ""}`, { method });

beforeEach(async () => {
  vi.stubEnv("MONGODB_URI", "");
  vi.stubEnv("KNOWLEDGE_STORE", "filesystem");
  vi.stubEnv("KNOWLEDGE_DIR", mkdtempSync(path.join(tmpdir(), "kb-owner-")));
  identity.id = "owner-a";
  const record = (id: string, ownerId: string, name: string, tag: string) => ({
    v: 1 as const, id, ownerId, fileName: name, scannedAt: "2026-01-01", variables: [{ name: tag, dataType: "BOOL", comment: "", address: "" }],
    bindings: [], partTypes: {}, naming: { separators: {}, cases: {}, prefixes: {}, suffixes: {}, numbered: 0, averageLength: 0 }, alarms: [], screens: [], equipment: [],
    source: { product: "OTE", layout: "typed" }, target: null,
    counts: { entries: 0, screens: 0, contentScreens: 0, objects: 0, variables: 1, alarms: 0, alarmGroups: 0, bindings: 0 },
    tables: {}, problems: [],
  }) as ProjectKnowledge;
  await putKnowledge(record(A, "owner-a", "a.eote", "A_SECRET"));
  await putKnowledge(record(B, "owner-b", "b.eote", "B_SECRET"));
});

it("scopes raw scans, listings, and deletion to their owner", async () => {
  expect((await GET(request(B))).status).toBe(404);
  const list = await (await GET(request())).text();
  expect(list).toContain("a.eote");
  expect(list).not.toContain("b.eote");
  expect((await DELETE(request(B, "DELETE"))).status).toBe(404);
  expect(await getKnowledge(B)).not.toBeNull();
  identity.id = "owner-b";
  expect((await (await GET(request(B))).text())).toContain("B_SECRET");
  expect((await GET(request(A))).status).toBe(404);
});

it("does not overwrite another owner's scan when the file hash matches", async () => {
  await expect(putKnowledge({ ...(await getKnowledge(B))!, ownerId: "owner-a" })).rejects.toThrow("another knowledge owner");
  expect((await getKnowledge(B))?.ownerId).toBe("owner-b");
});

it("keeps the same file opened by two accounts as two records, and tells neither about the other", async () => {
  const scan = (await getKnowledge(A))!;
  const first = await ownScan(scan, "owner-a");
  const second = await ownScan(scan, "owner-b");
  expect(first.id).not.toBe(second.id);
  expect(first.id).toMatch(/^[0-9a-f]{64}$/);
  await putKnowledge(first);
  await expect(putKnowledge(second)).resolves.toMatchObject({ id: second.id, isNew: true });
  // Repeating it is still one record for that account.
  await expect(putKnowledge(await ownScan(scan, "owner-b"))).resolves.toMatchObject({ isNew: false });
  // A laptop keeps the file's hash, so its older scans stay the same record.
  expect((await ownScan(scan, "local")).id).toBe(scan.id);
});
