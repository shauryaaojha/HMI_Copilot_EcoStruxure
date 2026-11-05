import { expect, it } from "vitest";
import { makeKb, type Entry } from "@/lib/kb";
import { canServe, getEntry, searchEntries } from "@/lib/kb/serve";
import { prepare, runTool as runChatTool } from "@/lib/ai/tools";
import { TOOL_BY_NAME } from "@/lib/agent/tools";

const entry: Entry = {
  id: "part:Fixture", kind: "partType", layer: "code", title: "Fixture reading", summary: "Shows a level reading.",
  tags: ["reading", "emitted"], body: { type: "Fixture", emitted: true }, related: [],
  source: { kind: "code", ref: "web/src/lib/ote/schema.ts#Fixture", inputHash: "fixture" }, rev: "fixture",
};
const kb = makeKb([entry], "fixed-version");

it("serves a fixed index through chat and agent tools", async () => {
  const chat = prepare({ tags: [], objects: [], kb });
  expect(runChatTool("kb_search", { query: "level reading", kinds: [], tags: [] }, chat).text).toContain("part:Fixture");
  expect(runChatTool("kb_get", { id: "part:Fixture" }, chat).text).toContain('"emitted":true');
  const agent = { ws: {} as never, kb, read: async () => { throw new Error("project read was not needed"); } };
  expect((await TOOL_BY_NAME.get("kb_search")!.run(agent, { query: "reading" })).text).toContain("part:Fixture");
  expect((await TOOL_BY_NAME.get("kb_get")!.run(agent, { id: "part:Fixture" })).text).toContain("Fixture");
  expect((await TOOL_BY_NAME.get("kb_related")!.run(agent, { id: "part:Fixture" })).text).toContain("[]");
});

it("caps search and refuses raw or private entries to model-facing serializers", () => {
  const privateEntry = { ...entry, id: "ex:private", layer: "corpus" as const, summary: "CUSTOMER_SECRET_MARKER" };
  const privateKb = makeKb([entry, privateEntry]);
  expect(canServe(privateEntry, "mcp")).toBe(false);
  expect(getEntry(privateKb, privateEntry.id, "chat")).toBeUndefined();
  expect(searchEntries(privateKb, "CUSTOMER_SECRET_MARKER", "agent")).toEqual([]);
  expect(getEntry(privateKb, "raw-scan-id", "mcp")).toBeUndefined();
  expect(canServe({ id: "raw-scan-id", variables: [{ name: "CUSTOMER_SECRET_MARKER" }] } as unknown as Entry, "mcp")).toBe(false);
});
