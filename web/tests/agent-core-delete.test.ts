/**
 * S3-02 (docs/audit/BUGS.md), moved from web/scripts/audit/ with the fix: the agent could delete the project's core files despite the guard.
 *
 * docs/AGENT_WORKSPACE.md: "Core files (Project.dat, Bindings.dat, a screen's
 * Screen.dat and Metadata.dat, the hierarchies) cannot be deleted."
 * lib/agent/tools.ts `delete_path` tests CORE only against the path it was
 * given, then deletes everything `ws.list(path)` returns - so a folder
 * ("Screens") or the empty path ("") takes every core file with it. And
 * `run_script`'s `ws.delete` (lib/agent/script.ts host.delete) never consults
 * CORE at all.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Workspace } from "@/lib/agent/workspace";
import { contextFor, runAgentTool } from "@/lib/agent/tools";

const SCREEN = "11111111-2222-3333-4444-555555555555";

async function project(): Promise<Workspace> {
  const zip = new JSZip();
  zip.file("Project.dat", JSON.stringify({ Name: "P" }));
  zip.file("Bindings.dat", JSON.stringify({ Sources: [], Targets: [], Bindings: [] }));
  zip.file("Screens\\Hierarchy.dat", JSON.stringify([{ ObjectId: SCREEN, Children: [] }]));
  zip.file(`Screens\\${SCREEN}\\Screen.dat`, JSON.stringify({ Type: "Screen", UniqueId: SCREEN, Name: "S1", Children: [] }));
  zip.file(`Screens\\${SCREEN}\\Metadata.dat`, JSON.stringify({ Id: 1, Name: "S1" }));
  zip.file("notes.txt", "scratch");
  return Workspace.open(await zip.generateAsync({ type: "uint8array" }), "t.eote");
}

const CORE = ["Project.dat", "Bindings.dat", "Screens/Hierarchy.dat", `Screens/${SCREEN}/Screen.dat`];

describe("S3-02 core files survive every delete the agent can make", () => {
  it("delete_path refuses Project.dat by name (the guard that exists)", async () => {
    const ws = await project();
    const r = await runAgentTool(contextFor(ws), "delete_path", { path: "Project.dat" });
    expect(r.isError).toBe(true);
    expect(ws.has("Project.dat")).toBe(true);
  });

  it.each([[""], ["Screens"]])("delete_path %j keeps every core file", async (path) => {
    const ws = await project();
    const r = await runAgentTool(contextFor(ws), "delete_path", { path });
    const gone = CORE.filter((p) => !ws.has(p));
    expect(gone, `delete_path ${JSON.stringify(path)} answered "${r.text}" and deleted core files: ${gone.join(", ")}`).toEqual([]);
  });

  it("run_script ws.delete keeps Project.dat", async () => {
    const ws = await project();
    const r = await runAgentTool(contextFor(ws), "run_script", { code: 'ws.delete("Project.dat"); "ok"' });
    expect(ws.has("Project.dat"), `run_script answered "${r.text.trim()}" and Project.dat is gone`).toBe(true);
  });

  it("delete_path on a whole screen folder still deletes the screen", async () => {
    const ws = await project();
    const r = await runAgentTool(contextFor(ws), "delete_path", { path: `Screens/${SCREEN}` });
    expect(r.isError, r.text).toBeFalsy();
    expect(ws.has(`Screens/${SCREEN}/Screen.dat`)).toBe(false);
    expect(ws.has("Project.dat")).toBe(true);
  });
});
