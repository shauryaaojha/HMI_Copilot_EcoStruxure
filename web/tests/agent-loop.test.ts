/**
 * The agent loop against a stand-in Claude client: it runs the tools the
 * model asks for, returns every result of a turn in one message, stops on
 * end_turn, and reports what it changed. lib/agent/run.ts.
 */

import { describe, expect, it } from "vitest";
import { Workspace } from "@/lib/agent/workspace";
import { runAgent, type AgentEvent } from "@/lib/agent/run";
import { packageProject } from "@/lib/ote/packager";
import { screenOf, switchPart } from "@/lib/ote/parts";

const target = { model: "HMIST6600", width: 1280, height: 800 };

type Reply = { content: unknown[]; stop_reason: string };

function fakeClaude(replies: Reply[]) {
  const sent: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          // The loop mutates its message list afterwards; keep what was sent.
          sent.push(structuredClone(params));
          const reply = replies.shift();
          if (!reply) throw new Error("no more replies");
          return { finalMessage: async () => ({ ...reply, usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50 } }) };
        },
      },
    },
  };
  return { client: client as never, sent };
}

async function project() {
  const start = switchPart("Start", "START", { left: 20, top: 20, width: 140, height: 44 });
  const bytes = await packageProject({
    name: "P", target, screens: [screenOf("Drive", [start], target)],
    variables: [{ Name: "Run_CMD", DataType: "BOOL", Comments: "", DeviceAddress: "" }] as never, alarms: [], wires: [],
  });
  return Workspace.open(bytes, "p.eote");
}

describe("the agent loop", () => {
  it("runs the tools Claude asks for, answers them together, and stops at end_turn", async () => {
    const ws = await project();
    const { client, sent } = fakeClaude([
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Looking first." },
          { type: "tool_use", id: "t1", name: "project_summary", input: {} },
          { type: "tool_use", id: "t2", name: "bind", input: { object: "Start", property: "ClickTrigger.Destination", tag: "Run_CMD", mode: 1 } },
        ],
      },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t3", name: "check", input: {} }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "START now writes Run_CMD." }] },
    ]);

    const events: AgentEvent[] = [];
    for await (const e of runAgent({ ws, instruction: "Bind START to Run_CMD", claude: client })) events.push(e);

    const results = events.filter((e) => e.type === "result");
    expect(results.map((r) => r.type === "result" && [r.name, r.ok])).toEqual([["project_summary", true], ["bind", true], ["check", true]]);
    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    if (done.type !== "done") return;
    expect(done.text).toBe("START now writes Run_CMD.");
    expect(done.provider).toBe("claude");
    expect(done.changes.map((c) => c.path)).toContain("Bindings.dat");

    // The second request carries both results of the first turn in one user message.
    const second = sent[1].messages as { role: string; content: { type: string; tool_use_id: string }[] }[];
    const last = second.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content.map((b) => b.tool_use_id)).toEqual(["t1", "t2"]);
    // Tools stream their input; the system prompt is cached.
    const tools = sent[0].tools as { eager_input_streaming?: boolean }[];
    expect(tools.every((t) => t.eager_input_streaming)).toBe(true);
    expect((sent[0].system as { cache_control?: unknown }[])[0].cache_control).toBeTruthy();
  });

  it("says when the model refuses, and changes nothing", async () => {
    const ws = await project();
    const { client } = fakeClaude([{ stop_reason: "refusal", content: [] }]);
    const events: AgentEvent[] = [];
    for await (const e of runAgent({ ws, instruction: "x", claude: client })) events.push(e);
    expect(events.some((e) => e.type === "error" && /declined/.test(e.message))).toBe(true);
    const done = events.at(-1)!;
    expect(done.type === "done" && done.changes).toEqual([]);
  });
});
