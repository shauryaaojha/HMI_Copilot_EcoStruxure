/**
 * Where an opened .eote lives between import and export.
 *
 * The bug this exists to prevent: on Vercel the functions are stateless, so a
 * file written to `.imports/` by the import request is not there when the
 * export request runs, and the download fails on every deployed instance while
 * working perfectly on a laptop. The store has to be chosen by configuration,
 * and both halves of it have to round-trip.
 *
 * The MongoDB half runs only when MONGODB_URI is set, so the suite stays
 * keyless - the same rule the model-backed tests follow.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const FIXTURE = join(process.cwd(), "..", "demo_project", "HMICopilot_PumpStation.eote");

/** Re-import the module so it reads the environment as it is now. */
async function store(uri?: string) {
  if (uri) process.env.MONGODB_URI = uri;
  else delete process.env.MONGODB_URI;
  // The module reads process.env on each call, but the cached client lives on
  // globalThis, so a reset between modes keeps the two independent.
  return import("@/lib/ote/imports");
}

const original = process.env.MONGODB_URI;
afterAll(() => {
  if (original) process.env.MONGODB_URI = original;
  else delete process.env.MONGODB_URI;
});

describe("choosing a store", () => {
  beforeEach(() => {
    delete process.env.MONGODB_URI;
  });

  it("uses the filesystem with no database configured, and MongoDB with one", async () => {
    const mod = await store();
    expect(mod.importStore()).toBe("filesystem");
    process.env.MONGODB_URI = "mongodb://localhost:27017";
    expect(mod.importStore()).toBe("mongo");
    delete process.env.MONGODB_URI;
    expect(mod.importStore()).toBe("filesystem");
  });

  it("says something true about where the file went when it is gone", async () => {
    const mod = await store();
    expect(mod.importGoneMessage("filesystem")).toMatch(/no longer on this machine/);
    expect(mod.importGoneMessage("mongo")).toMatch(/kept for 24 hours/);
  });

  it("keeps an opened project for a day and no longer", async () => {
    const mod = await store();
    expect(mod.IMPORT_TTL_SECONDS).toBe(86400);
  });
});

describe("the filesystem store", () => {
  it("round-trips a real project's bytes", async () => {
    const mod = await store();
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const id = await mod.putImport(bytes, "HMICopilot_PumpStation.eote");
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    const back = await mod.getImport(id);
    expect(back).not.toBeNull();
    expect(Buffer.compare(Buffer.from(back!), Buffer.from(bytes))).toBe(0);
  });

  it("returns null for a handle it never issued, and refuses one that is not a handle", async () => {
    const mod = await store();
    expect(await mod.getImport(crypto.randomUUID())).toBeNull();
    // Not a uuid: rejected before it can reach a filesystem or a query.
    expect(await mod.getImport("../../etc/passwd")).toBeNull();
    expect(await mod.getImport("")).toBeNull();
  });
});

// Runs against a real cluster when one is configured: `MONGODB_URI=... npm test`.
describe.runIf(process.env.MONGODB_URI)("the MongoDB store", () => {
  it("round-trips a real project's bytes through the database", async () => {
    const mod = await store(process.env.MONGODB_URI);
    expect(mod.importStore()).toBe("mongo");
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const id = await mod.putImport(bytes, "HMICopilot_PumpStation.eote");
    const back = await mod.getImport(id);
    expect(back).not.toBeNull();
    expect(Buffer.compare(Buffer.from(back!), Buffer.from(bytes))).toBe(0);
  });

  it("refuses a file larger than a document can hold, with a reason", async () => {
    const mod = await store(process.env.MONGODB_URI);
    const huge = new Uint8Array(15_000_001);
    await expect(mod.putImport(huge, "huge.eote")).rejects.toThrow(/16MB/);
  });
});
