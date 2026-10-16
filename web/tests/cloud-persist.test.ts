/** Device cache, debouncing and conflicts without React, network or a database. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sample } from "./fixtures/collab";
let storage: Map<string, string>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); storage = new Map();
  const local = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: local }));
  fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const me = { user: { id: "alice", name: "Alice" }, cloud: true, providers: ["github"] };
it("writes through locally and saves only after 1.5 seconds without changes", async () => {
  const p = await import("@/store/persist");
  fetcher.mockImplementation(async (url: string) => Response.json(url === "/api/me" ? me : { project: { rev: 1 } }));
  p.saveProject(sample()); expect(p.loadProject("project-test")?.name).toBe("Station");
  await vi.advanceTimersByTimeAsync(1000); p.saveProject({ ...sample(), name: "Latest" });
  await vi.advanceTimersByTimeAsync(1499); expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(JSON.parse(fetcher.mock.calls[1][1].body).snapshot.name).toBe("Latest");
  expect(p.cloudStatus("project-test")).toBe("Saved");
});
it("retains its own revision across other tabs and pauses after a conflict", async () => {
  const p = await import("@/store/persist");
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === "/api/me") return Response.json(me);
    if (!options?.method) return Response.json({ rev: 1, snapshot: sample() });
    return Response.json({ error: "Changed elsewhere", code: "conflict", rev: 2, snapshot: { ...sample(), name: "Remote" } }, { status: 409 });
  });
  await p.loadCloudProject("project-test");
  // Another tab acknowledges revision 2 in the shared device metadata.
  storage.set("hmi-copilot:sync:project-test", JSON.stringify({ userId: "alice", rev: 2, dirty: false }));
  p.saveProject({ ...sample(), name: "Mine" }); await vi.advanceTimersByTimeAsync(1500);
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).rev).toBe(1);
  expect(p.cloudStatus("project-test")).toBe("Changed elsewhere"); expect(p.loadProject("project-test")?.name).toBe("Mine");
  const count = fetcher.mock.calls.length;
  p.saveProject({ ...sample(), name: "Still mine" }); await vi.advanceTimersByTimeAsync(3000); expect(fetcher).toHaveBeenCalledTimes(count);
  const remote = await p.resolveCloudConflict("project-test", false); expect(remote?.name).toBe("Remote");
});
it("keeps offline work across a reload and detects a changed server", async () => {
  let p = await import("@/store/persist");
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === "/api/me") return Response.json(me);
    if (!options?.method) return Response.json({ rev: 1, snapshot: sample() });
    throw new Error("offline");
  });
  await p.loadCloudProject("project-test"); p.saveProject({ ...sample(), name: "Offline edit" }); await vi.advanceTimersByTimeAsync(1500);
  expect(p.cloudStatus("project-test")).toBe("Offline - saved on this device");
  vi.resetModules(); p = await import("@/store/persist");
  fetcher.mockImplementation(async (url: string) => Response.json(url === "/api/me" ? me : { rev: 2, snapshot: sample() }));
  expect((await p.loadCloudProject("project-test"))?.name).toBe("Offline edit");
  expect(p.cloudStatus("project-test")).toBe("Changed elsewhere");
});
it("never uploads when the public site has cloud disabled", async () => {
  const p = await import("@/store/persist");
  fetcher.mockResolvedValue(Response.json({ user: null, cloud: false, providers: [] }));
  p.saveProject(sample()); await vi.advanceTimersByTimeAsync(1500);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe("/api/me");
});
