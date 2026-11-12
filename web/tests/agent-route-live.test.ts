/**
 * The agent route on the project as the app holds it (POST project): a
 * project built in the app, with no file, is written the way the export
 * writes it and opened as the agent's working directory; and the agent's
 * save comes back as a project to load.
 */
import { afterEach, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ screens: [] as string[], file: "" }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/server/model-gate", () => ({ modelCaller: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent/run", () => ({
  runAgent: async function* ({ ws }: { ws: import("@/lib/agent/workspace").Workspace }) {
    const { readProject } = await import("@/lib/ote/reader");
    const read = await readProject(await ws.toBytes(), ws.fileName);
    seen.screens = read.screens.map((x) => x.Name);
    seen.file = ws.fileName;
    // A change, so the route saves and answers with the project.
    ws.writeText("Notes.txt", "agent was here");
    yield { type: "done", text: "ok", changes: ws.changes(), steps: 1, provider: "openai", model: "test" };
  },
}));

import { POST } from "@/app/api/agent/route";
import { createProjectStore } from "@/store/project";
import { packageInputOf } from "@/lib/collab/package";
import { screenOf, switchPart } from "@/lib/ote/parts";

afterEach(() => vi.unstubAllEnvs());

it("works on a project built in the app, with no file, and hands back the saved project", async () => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("AUTH_SECRET", "");
  const target = { model: "HMIST6600", width: 1280, height: 800 };
  const store = createProjectStore();
  store.getState().hydrate({
    name: "Built Here",
    target,
    screens: [screenOf("Home", [switchPart("Start", "START", { left: 40, top: 120, width: 140, height: 44 })], target)],
    variables: [],
    alarms: [],
    bindings: [],
  } as never);
  const response = await POST(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ project: packageInputOf(store.getState()), message: "look" }),
    }),
  );
  const lines = (await response.text()).trim().split("\n").map((l) => JSON.parse(l) as { type: string; project?: { screens: { Name: string }[] }; message?: string });
  expect(lines.find((l) => l.type === "error")?.message).toBeUndefined();
  expect(seen.screens).toEqual(["Home"]);
  expect(seen.file).toBe("Built_Here.eote");
  const saved = lines.find((l) => l.type === "saved");
  expect(saved?.project?.screens.map((x) => x.Name)).toEqual(["Home"]);
});

it("still refuses a call with neither a file nor a project", async () => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("AUTH_SECRET", "");
  const response = await POST(
    new Request("http://localhost/api/agent", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ message: "look" }) }),
  );
  expect(response.status).toBe(400);
});
