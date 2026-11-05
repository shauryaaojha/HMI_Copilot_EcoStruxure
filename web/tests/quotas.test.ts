import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseRepo } from "@/lib/server/repo";
import { MemoryStorage } from "@/lib/server/storage";
import { sample } from "./fixtures/collab";

afterEach(() => vi.unstubAllEnvs());

describe("storage quotas", () => {
  it("do not count the implicit local engineer, whose installation may hold more", async () => {
    vi.stubEnv("MAX_PROJECTS_PER_ACCOUNT", "1");
    vi.stubEnv("MAX_ACCOUNT_SOURCE_BYTES", "7");
    const storage = new BaseRepo(new MemoryStorage());
    await storage.projects.create("local", sample());
    await storage.projects.create("local", { ...sample(), id: "second-project" });
    await storage.sources.put(new Uint8Array(5), "first", "local");
    await storage.sources.put(new Uint8Array(5), "second", "local");
    await storage.uploads.create("third", 5, "local");
  });

  it("refuses the next owned project and comment without removing existing rows", async () => {
    vi.stubEnv("MAX_PROJECTS_PER_ACCOUNT", "1");
    vi.stubEnv("MAX_COMMENTS_PER_PROJECT", "1");
    const memory = new MemoryStorage(), storage = new BaseRepo(memory);
    await storage.projects.create("owner", sample());
    await expect(storage.projects.create("owner", { ...sample(), id: "second-project" })).rejects.toMatchObject({ status: 429, code: "quota" });
    await storage.comments.create("project-test", "owner", { body: "First" });
    await expect(storage.comments.create("project-test", "owner", { body: "Second" })).rejects.toMatchObject({ status: 429, code: "quota" });
    expect(memory.rows("projects")).toHaveLength(1);
    expect(memory.rows("comments")).toHaveLength(1);
  });

  it("checks per-file and account bytes before storing sources or uploads", async () => {
    vi.stubEnv("MAX_SOURCE_BYTES", "5");
    vi.stubEnv("MAX_UPLOAD_BYTES", "5");
    vi.stubEnv("MAX_ACCOUNT_SOURCE_BYTES", "7");
    const memory = new MemoryStorage(), storage = new BaseRepo(memory);
    await expect(storage.sources.put(new Uint8Array(6), "too-big", "owner")).rejects.toMatchObject({ status: 413, code: "quota" });
    const first = await storage.sources.put(new Uint8Array(4), "first", "owner");
    await expect(storage.sources.put(new Uint8Array(4), "next", "owner")).rejects.toMatchObject({ status: 413, code: "quota" });
    await expect(storage.uploads.create("too-big", 6, "owner")).rejects.toMatchObject({ status: 413, code: "quota" });
    const upload = await storage.uploads.create("fits", 3, "owner");
    await expect(storage.uploads.create("over", 1, "owner")).rejects.toMatchObject({ status: 413, code: "quota" });
    await storage.uploads.part(upload._id, 0, new Uint8Array(3), "owner");
    expect(await storage.uploads.complete(upload._id, "owner")).toBeTruthy();
    expect((await storage.sources.get(first))?.bytes.length).toBe(4);
    expect(memory.rows("sources")).toHaveLength(2);
  });

  it("caps anonymous uploads both individually and in flight", async () => {
    vi.stubEnv("MAX_UPLOAD_BYTES", "10");
    vi.stubEnv("MAX_ANONYMOUS_UPLOAD_BYTES", "4");
    vi.stubEnv("MAX_ANONYMOUS_UPLOAD_TOTAL_BYTES", "5");
    const memory = new MemoryStorage(), storage = new BaseRepo(memory);
    await expect(storage.uploads.create("large", 5, null)).rejects.toThrow(/Anonymous upload limit is 4 bytes/);
    await storage.uploads.create("first", 4, null);
    await expect(storage.uploads.create("next", 2, null)).rejects.toThrow(/Anonymous uploads in flight limit is 5 bytes/);
    expect(memory.rows("uploads")).toHaveLength(1);
  });

  it("releases the anonymous in-flight reservation once an upload completes", async () => {
    vi.stubEnv("MAX_ANONYMOUS_UPLOAD_BYTES", "4");
    vi.stubEnv("MAX_ANONYMOUS_UPLOAD_TOTAL_BYTES", "4");
    const storage = new BaseRepo(new MemoryStorage());
    const first = await storage.uploads.create("first", 4, null);
    await storage.uploads.part(first._id, 0, new Uint8Array(4), null);
    await storage.uploads.complete(first._id, null);
    await expect(storage.uploads.create("next", 4, null)).resolves.toMatchObject({ fileName: "next" });
  });
});
