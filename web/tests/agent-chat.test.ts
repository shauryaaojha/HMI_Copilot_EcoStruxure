/**
 * The chat's agent loop (lib/ai/agent-chat.ts), with Gemini scripted.
 *
 * What is held: the loop runs the tools it is asked for on a draft and hands
 * the answers back (a picture for render_screen); an answer whose ops would be
 * refused is sent back once instead of reaching the browser; the project the
 * caller passed in is never changed; a per-minute rate limit is waited out and
 * a daily one is not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { docOf } from "@/lib/collab/changes";
import { digestOf } from "@/lib/ai/converse";
import { createProjectStore } from "@/store/project";

type Call = { name: string; args: Record<string, unknown>; id?: string };
const script = vi.hoisted(() => ({ replies: [] as (Call[] | Error)[], seen: [] as unknown[] }));

vi.mock("@google/genai", () => ({
  FunctionCallingConfigMode: { ANY: "ANY" },
  GoogleGenAI: class {
    models = {
      generateContent: async (params: { contents: unknown[] }) => {
        script.seen.push(structuredClone(params.contents));
        const next = script.replies.shift();
        if (!next) throw new Error("the script ran out");
        if (next instanceof Error) throw next;
        const calls = next.map((c, i) => ({ ...c, id: c.id ?? `call-${script.seen.length}-${i}` }));
        return {
          candidates: [{ content: { role: "model", parts: calls.map((c) => ({ functionCall: c })) } }],
          functionCalls: calls,
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
        };
      },
    };
  },
}));

const { agentChat } = await import("@/lib/ai/agent-chat");

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
  const doc = docOf(s);
  const digest = digestOf({ ...s, selectedIds: [] }, "move the lamp");
  return { doc, digest };
}

const input = () => {
  const { doc, digest } = project();
  return { history: [{ role: "user" as const, text: "Move the pump lamp to the right" }], digest, doc };
};

/** The last user message the model was sent, as parts. */
const lastSent = () => {
  const contents = script.seen.at(-1) as { role: string; parts: Record<string, unknown>[] }[];
  return contents.at(-1)!.parts;
};

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  script.replies = [];
  script.seen = [];
});

describe("the agent loop", () => {
  it("tries ops on a draft, fixes what was refused, and finishes with the working list", async () => {
    script.replies = [[{ name: "try_ops", args: { ops: [BAD] } }], [{ name: "try_ops", args: { ops: [GOOD] } }], [finish([GOOD])]];
    const before = input();
    const snapshot = JSON.stringify(before.doc);
    const result = await agentChat(before, "gemini-test");
    expect(result?.turn).toMatchObject({ mode: "edit", ops: [GOOD] });
    expect(result?.steps.map((s) => s.tool)).toEqual(["try_ops", "try_ops"]);
    expect(result?.steps[0]).toMatchObject({ isError: true });
    expect(result?.steps[0].summary).toContain("0 applied, 1 refused");
    expect(result?.steps[1].summary).toContain("1 applied, 0 refused");
    // The refusal reached the model as a tool answer it could act on.
    const second = script.seen[1] as { parts: { functionResponse?: { response: Record<string, string> } }[] }[];
    expect(JSON.stringify(second.at(-1))).toContain("No_Such_Lamp");
    // And nothing the loop did touched the project it was given.
    expect(JSON.stringify(before.doc)).toBe(snapshot);
  });

  it("sends an answer with refused ops back once, instead of letting it reach the browser", async () => {
    script.replies = [[finish([GOOD, BAD])], [finish([GOOD])]];
    const result = await agentChat(input(), "gemini-test");
    expect(result?.turn.ops).toEqual([GOOD]);
    expect(result?.steps).toHaveLength(1);
    expect(result?.steps[0]).toMatchObject({ tool: "finish", isError: true });
    expect(JSON.stringify(lastSent())).toContain("Not finished");
  });

  it("shows the model the screen it asked to see, as a picture", async () => {
    script.replies = [[{ name: "render_screen", args: {} }], [{ name: "finish", args: { mode: "answer", reply: "It looks fine." } }]];
    const result = await agentChat(input(), "gemini-test");
    expect(result?.turn).toMatchObject({ mode: "answer" });
    const reply = lastSent()[0] as { functionResponse: { name: string; parts?: { inlineData: { mimeType: string; data: string } }[] } };
    expect(reply.functionResponse.name).toBe("render_screen");
    expect(reply.functionResponse.parts?.[0].inlineData.mimeType).toBe("image/png");
    expect(reply.functionResponse.parts![0].inlineData.data.length).toBeGreaterThan(1000);
  });

  it("answers a lookup from the registry and a screen from the draft", async () => {
    script.replies = [
      [
        { name: "find_tags", args: { query: "PUMP" } },
        { name: "get_screen", args: { screen: demoScreen.Name } },
      ],
      [{ name: "finish", args: { mode: "answer", reply: "Found them." } }],
    ];
    const result = await agentChat(input(), "gemini-test");
    expect(result?.steps.map((s) => s.tool)).toEqual(["find_tags", "get_screen"]);
    const parts = lastSent() as { functionResponse: { response: { output?: string } } }[];
    expect(parts).toHaveLength(2);
    expect(parts[1].functionResponse.response.output).toContain("Objects on it");
  });

  it("waits out a per-minute rate limit, and gives up at once on a daily one", async () => {
    const minute = Object.assign(new Error('{"error":{"code":429,"message":"Quota exceeded for metric: requests per minute. Please retry in 1s."}}'), { status: 429 });
    script.replies = [minute, [{ name: "finish", args: { mode: "answer", reply: "Done." } }]];
    const result = await agentChat(input(), "gemini-test");
    expect(result?.turn.reply).toBe("Done.");
    expect(result?.steps[0]).toMatchObject({ tool: "wait" });

    const day = Object.assign(new Error('{"error":{"code":429,"message":"GenerateRequestsPerDayPerProjectPerModel-FreeTier. Please retry in 2h45m39s."}}'), { status: 429 });
    script.replies = [day];
    await expect(agentChat(input(), "gemini-test")).rejects.toMatchObject({ status: 429 });
  });
});
