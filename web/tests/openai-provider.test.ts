/**
 * The gateway provider (lib/ai/openai.ts, AI_PROVIDER=openai) and the two
 * loops on it, with the OpenAI SDK scripted.
 *
 * What is held: the provider needs both the key and the base URL; the chat
 * loop runs the tools it is asked for on a draft, answers each call as a
 * tool message, sends a picture as the user, bounces an answer whose ops are
 * refused, forces finish on the last step, and never changes the project;
 * askJson falls back from json_schema to a forced tool on a 400; the
 * workspace agent loop answers every call and reports what changed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { docOf } from "@/lib/collab/changes";
import { digestOf } from "@/lib/ai/converse";
import { createProjectStore } from "@/store/project";
import { Workspace } from "@/lib/agent/workspace";
import { packageProject } from "@/lib/ote/packager";
import { screenOf, switchPart } from "@/lib/ote/parts";

type Call = { name: string; args: Record<string, unknown>; id?: string };
type Reply = Call[] | { text: string } | Error;
const script = vi.hoisted(() => ({ replies: [] as Reply[], seen: [] as Record<string, unknown>[] }));

vi.mock("openai", () => {
  class APIError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  class OpenAI {
    static APIError = APIError;
    chat = {
      completions: {
        create: async (params: Record<string, unknown>) => {
          script.seen.push(structuredClone(params));
          const next = script.replies.shift();
          if (!next) throw new Error("the script ran out");
          if (next instanceof Error) throw next;
          const n = script.seen.length;
          const message = Array.isArray(next)
            ? {
                role: "assistant",
                content: null,
                reasoning_content: "thought about it",
                tool_calls: next.map((c, i) => ({ id: c.id ?? `call-${n}-${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
              }
            : { role: "assistant", content: next.text };
          return {
            choices: [{ index: 0, message, finish_reason: Array.isArray(next) ? "tool_calls" : "stop" }],
            usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } },
          };
        },
      },
    };
  }
  return { default: OpenAI, OpenAI, APIError };
});

const { agentChat } = await import("@/lib/ai/agent-chat");
const { resolveProvider } = await import("@/lib/ai/provider");
const { askJson } = await import("@/lib/ai/draft");
const { converse } = await import("@/lib/ai/converse");
const { runAgent } = await import("@/lib/agent/run");

const GOOD = { op: "moveObject", target: "Lamp_PUMP1_RUN", left: 400, top: 300 };
const BAD = { op: "moveObject", target: "No_Such_Lamp", left: 10, top: 10 };
const finish = (ops: unknown[]): Call => ({ name: "finish", args: { mode: "edit", reply: "Moved the lamp.", ops } });

function project() {
  const store = createProjectStore();
  store.getState().hydrate({
    id: "p",
    name: "Pump station",
    target: { model: "HMIST6500", width: 1024, height: 600 },
    screens: [structuredClone(demoScreen)],
    activeScreenId: demoScreen.UniqueId,
    variables: structuredClone(demoVariables),
    alarms: [],
    bindings: [],
    objectMeta: {},
    screenPlacement: {},
    versions: [],
    chat: [],
  });
  const s = store.getState();
  return { doc: docOf(s), digest: digestOf({ ...s, selectedIds: [] }, "move the lamp") };
}

const input = () => {
  const { doc, digest } = project();
  return { history: [{ role: "user" as const, text: "Move the pump lamp to the right" }], digest, doc };
};

type Msg = { role: string; content: unknown; tool_call_id?: string };
const messagesOf = (i: number) => script.seen[i].messages as Msg[];

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_BASE_URL", "https://api.example.in/v1");
  vi.stubEnv("AI_MODEL", "");
  vi.stubEnv("AI_REASONING", "");
  script.replies = [];
  script.seen = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("the provider", () => {
  it("needs both the key and the endpoint, and names the host rather than OpenAI", () => {
    expect(resolveProvider()).toMatchObject({ provider: "openai", model: "z-ai/glm-5.3-flash", reason: "example.in (AI_PROVIDER)" });
    vi.stubEnv("OPENAI_BASE_URL", "");
    expect(resolveProvider()).toMatchObject({ provider: null, reason: expect.stringContaining("OPENAI_BASE_URL") });
    vi.stubEnv("OPENAI_BASE_URL", "https://api.example.in/v1");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(resolveProvider()).toMatchObject({ provider: null, reason: expect.stringContaining("OPENAI_API_KEY") });
  });
});

describe("the chat loop on the gateway", () => {
  it("tries ops on a draft, fixes what was refused, and finishes with the working list", async () => {
    script.replies = [[{ name: "try_ops", args: { ops: [BAD] } }], [{ name: "try_ops", args: { ops: [GOOD] } }], [finish([GOOD])]];
    const before = input();
    const snapshot = JSON.stringify(before.doc);
    const result = await agentChat(before, "glm-test", "openai");
    expect(result).toMatchObject({ provider: "openai", model: "glm-test", usage: { input: 300, cached: 120, output: 30 } });
    expect(result?.turn).toMatchObject({ mode: "edit", ops: [GOOD] });
    // What it reasoned before each call is a step of its own, in order.
    expect(result?.steps.map((s) => s.tool)).toEqual(["thought", "try_ops", "thought", "try_ops", "thought"]);
    expect(result?.steps[0]).toMatchObject({ tool: "thought", summary: "thought about it" });
    const tools = result!.steps.filter((s) => s.tool !== "thought");
    expect(tools[0]).toMatchObject({ tool: "try_ops", isError: true });
    // Every step is forced to be a tool call; the step is reasoned; the system prompt leads.
    expect(script.seen[0]).toMatchObject({ model: "glm-test", tool_choice: "required", reasoning_effort: "medium" });
    expect(messagesOf(0)[0].role).toBe("system");
    // The refusal reached the model as a tool message it could act on, and the
    // model's own message went back whole, reasoning included.
    const second = messagesOf(1);
    expect(second.at(-2)).toMatchObject({ role: "assistant", reasoning_content: "thought about it" });
    expect(second.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call-1-0" });
    expect(String(second.at(-1)!.content)).toContain("No_Such_Lamp");
    expect(JSON.stringify(before.doc)).toBe(snapshot);
  });

  it("sends an answer with refused ops back once, as a tool message", async () => {
    script.replies = [[finish([GOOD, BAD])], [finish([GOOD])]];
    const result = await agentChat(input(), "glm-test", "openai");
    expect(result?.turn.ops).toEqual([GOOD]);
    expect(result?.steps.filter((s) => s.tool !== "thought")).toEqual([expect.objectContaining({ tool: "finish", isError: true })]);
    expect(messagesOf(1).at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("Not finished") });
  });

  it("shows the model the screen it asked to see, as a picture in a user message", async () => {
    script.replies = [[{ name: "render_screen", args: {} }], [{ name: "finish", args: { mode: "answer", reply: "It looks fine." } }]];
    const result = await agentChat(input(), "glm-test", "openai");
    expect(result?.turn).toMatchObject({ mode: "answer" });
    const sent = messagesOf(1);
    expect(sent.at(-2)).toMatchObject({ role: "tool", content: expect.stringContaining("Screen ") });
    const picture = sent.at(-1) as { role: string; content: { type: string; image_url?: { url: string } }[] };
    expect(picture.role).toBe("user");
    expect(picture.content[1].type).toBe("image_url");
    expect(picture.content[1].image_url!.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(picture.content[1].image_url!.url.length).toBeGreaterThan(1000);
  });

  it("answers every call of a step, the registry's and the draft's", async () => {
    script.replies = [
      [
        { name: "find_tags", args: { query: "PUMP" } },
        { name: "get_screen", args: { screen: demoScreen.Name } },
      ],
      [{ name: "finish", args: { mode: "answer", reply: "Found them." } }],
    ];
    const result = await agentChat(input(), "glm-test", "openai");
    expect(result?.steps.filter((s) => s.tool !== "thought").map((s) => s.tool)).toEqual(["find_tags", "get_screen"]);
    const answers = messagesOf(1).filter((m) => m.role === "tool");
    expect(answers.map((m) => m.tool_call_id)).toEqual(["call-1-0", "call-1-1"]);
    expect(String(answers[1].content)).toContain("Objects on it");
  });

  it("forces finish on the last step, and honours the reasoning override", async () => {
    vi.stubEnv("AI_REASONING", "high");
    script.replies = [...Array.from({ length: 10 }, () => [{ name: "try_ops", args: { ops: [GOOD] } }]), [finish([GOOD])]];
    const result = await agentChat(input(), "glm-test", "openai");
    expect(result?.turn.ops).toEqual([GOOD]);
    const last = script.seen.at(-1)!;
    expect(last.tool_choice).toEqual({ type: "function", function: { name: "finish" } });
    expect((last.tools as unknown[]).length).toBe(1);
    expect(last.reasoning_effort).toBe("high");
  });

  it("waits out a rate limit and then goes on", async () => {
    const limited = Object.assign(new Error("429 rate limited"), { status: 429, headers: { "retry-after": "0" } });
    script.replies = [limited, [{ name: "finish", args: { mode: "answer", reply: "Done." } }]];
    const result = await agentChat(input(), "glm-test", "openai");
    expect(result?.turn.reply).toBe("Done.");
    expect(result?.steps[0]).toMatchObject({ tool: "wait", summary: expect.stringContaining("example.in") });
  });

  it("hands each step to the caller as it happens", async () => {
    script.replies = [[{ name: "find_tags", args: { query: "PUMP" } }], [{ name: "finish", args: { mode: "answer", reply: "Found." } }]];
    const seen: string[] = [];
    const result = await agentChat({ ...input(), onStep: (s) => seen.push(s.tool) }, "glm-test", "openai");
    expect(seen).toEqual(result?.steps.map((s) => s.tool));
    expect(seen).toEqual(["thought", "find_tags", "thought"]);
  });

  it("drafts tags for a project with none and finishes with a build that carries them", async () => {
    script.replies = [
      [{ name: "draft_tags", args: { units: [{ kind: "pump", label: "Feed pump", count: 2 }, { kind: "tank", label: "Buffer tank", count: 1 }] } }],
      [{ name: "finish", args: { mode: "build", reply: "Drafted 2 pumps and a tank; placeholders until the PLC program has the real tags.", buildIntent: "a pump station with two pumps and a tank", ops: [{ op: "addTag", name: "PMP_101_RUN", dataType: "BOOL", comment: "Pump 1 running" }] } }],
    ];
    const bare = input();
    bare.doc = { ...bare.doc, variables: [] };
    const result = await agentChat(bare, "glm-test", "openai");
    expect(result?.turn).toMatchObject({ mode: "build", buildIntent: "a pump station with two pumps and a tank" });
    expect(result?.turn.ops).toEqual([{ op: "addTag", name: "PMP_101_RUN", dataType: "BOOL", comment: "Pump 1 running" }]);
    const answer = messagesOf(1).find((m) => m.role === "tool");
    expect(String(answer?.content)).toContain("PMP_101_RUN");
    expect(String(answer?.content)).toContain("LT_101_PV");
    expect(String(answer?.content)).toContain('"op":"addTag"');
    expect(result?.steps.find((s) => s.tool === "draft_tags")?.summary).toContain("tags drafted");
  });
});

describe("one JSON answer", () => {
  it("comes back parsed, and through a forced tool when the gateway refuses json_schema", async () => {
    script.replies = [{ text: "```json\n{\"tags\":[{\"name\":\"PMP_101_RUN\"}]}\n```" }];
    expect(await askJson("sys", "draft", { type: "object" })).toEqual({ tags: [{ name: "PMP_101_RUN" }] });
    expect(script.seen[0]).toMatchObject({ response_format: { type: "json_schema" }, reasoning_effort: "medium" });

    const { APIError } = (await import("openai")) as unknown as { APIError: new (status: number, message: string) => Error };
    script.replies = [new APIError(400, "response_format is not supported"), [{ name: "answer", args: { tags: [] } }]];
    expect(await askJson("sys", "draft", { type: "object" })).toEqual({ tags: [] });
    expect(script.seen[2]).toMatchObject({ tool_choice: { type: "function", function: { name: "answer" } } });
  });

  it("is the single-call chat when the loop has no doc", async () => {
    script.replies = [{ text: "{\"mode\":\"answer\",\"reply\":\"Two screens.\"}" }];
    const { digest } = project();
    const result = await converse({ history: [{ role: "user", text: "How many screens?" }], digest });
    expect(result).toMatchObject({ provider: "openai", model: "z-ai/glm-5.3-flash", turn: { mode: "answer", reply: "Two screens." }, usage: { input: 100, cached: 40, output: 10 } });
    expect(script.seen[0]).toMatchObject({ response_format: { type: "json_schema", json_schema: { name: "turn" } } });
  });
});

describe("the workspace agent on the gateway", () => {
  async function workspace() {
    const target = { model: "HMIST6600", width: 1280, height: 800 };
    const start = switchPart("Start", "START", { left: 20, top: 20, width: 140, height: 44 });
    const bytes = await packageProject({
      name: "P",
      target,
      screens: [screenOf("Drive", [start], target)],
      variables: [{ Name: "Run_CMD", DataType: "BOOL", Comments: "", DeviceAddress: "" }] as never,
      alarms: [],
      wires: [],
    });
    return Workspace.open(bytes, "p.eote");
  }

  it("runs the tools it is asked for, answers each as a tool message, and reports what changed", async () => {
    vi.stubEnv("AGENT_EFFORT", "xhigh");
    const ws = await workspace();
    script.replies = [
      [
        { name: "project_summary", args: {} },
        { name: "bind", args: { object: "Start", property: "ClickTrigger.Destination", tag: "Run_CMD", mode: 1 } },
      ],
      [{ name: "check", args: {} }],
      { text: "START now writes Run_CMD." },
    ];
    const { default: OpenAI } = await import("openai");
    const events = [];
    for await (const e of runAgent({ ws, instruction: "Bind START to Run_CMD", openai: new OpenAI() as never })) events.push(e);
    const results = events.filter((e) => e.type === "result");
    expect(results.map((r) => r.type === "result" && [r.name, r.ok])).toEqual([
      ["project_summary", true],
      ["bind", true],
      ["check", true],
    ]);
    const done = events.at(-1)!;
    expect(done).toMatchObject({ type: "done", text: "START now writes Run_CMD.", provider: "openai", model: "z-ai/glm-5.3-flash" });
    expect(events.filter((e) => e.type === "thought").map((e) => e.type === "thought" && e.text)).toEqual(["thought about it", "thought about it"]);
    expect(done.type === "done" && done.changes.map((c) => c.path)).toContain("Bindings.dat");
    expect(events[0]).toMatchObject({ type: "status", message: expect.stringContaining("example.in (z-ai/glm-5.3-flash)") });
    // Claude's effort word became this dialect's; both results of the first turn were answered by id.
    expect(script.seen[0].reasoning_effort).toBe("high");
    const second = messagesOf(1);
    expect(second.slice(-2).map((m) => [m.role, m.tool_call_id])).toEqual([
      ["tool", "call-1-0"],
      ["tool", "call-1-1"],
    ]);
  });
});
