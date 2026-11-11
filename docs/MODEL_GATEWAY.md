# The model gateway: GLM, Qwen, DeepSeek or Opus behind one switch

Written 2026-11-11. The app's fourth provider, `AI_PROVIDER=openai`, is any endpoint that speaks the OpenAI Chat Completions dialect. It is how the chat loop, the workspace agent, the planner, the tag drafter and the critic run on models that cost a tenth of Gemini Flash, and how Opus can be given to the agent without an Anthropic key.

## Configure

| Variable | Value | Notes |
|---|---|---|
| `AI_PROVIDER` | `openai` | both variables below are required; the SDK's own default URL would send a GLM id to OpenAI |
| `OPENAI_BASE_URL` | `https://api.aicredits.in/v1` | or Vercel AI Gateway, OpenRouter, Z.ai's own endpoint |
| `OPENAI_API_KEY` | the gateway's key | Vercel env, never git |
| `AI_MODEL` | `z-ai/glm-5.3-flash` (default) | any id the gateway lists |
| `AGENT_MODEL` | unset, or `anthropic/claude-opus-5.5` | the workspace agent's model when it should differ from the chat's |
| `AI_REASONING` | unset | overrides the effort every call sends: `low`, `medium`, `high`, or `none` to send nothing |
| `OPENAI_FALLBACK_MODEL` | unset, or `google/gemini-3.8-flash` | one-call fallback on the same gateway when the loop's model is out of quota or overloaded |
| `AGENT_EFFORT` | `high` (default) | Claude's word, mapped to `reasoning_effort`; `xhigh` and `max` become `high` |

Unset `AI_REASONING`, each call states what it needs: `high` for planning and the workspace agent, `medium` for a chat step and the critic, `low` for a repair. GLM-5.3-Flash is a thinking model: it decides how much to think and the hint says how hard the step is; its reasoning comes back as `reasoning_content` and is sent back with its tool calls, the way Gemini's thought signatures are.

The code: `web/src/lib/ai/openai.ts` (client, reasoning, retry, one JSON answer), `agentChatOpenAI` in `web/src/lib/ai/agent-chat.ts`, `openaiLoop` in `web/src/lib/agent/run.ts`, `withOpenAI` in `web/src/lib/ai/converse.ts`, and the `openai` branches of `plan.ts`, `draft.ts` and `critic/critic.ts`. Tests: `web/tests/openai-provider.test.ts`.

## What was checked, and against what

Three Indian gateways that take UPI were tried on 2026-11-11, each with a ₹50 or smaller top-up:

| Gateway | Tools reach the model | Model asked for is the model used | Verdict |
|---|---|---|---|
| Yantra (api.aitklabs.in) | No: `tools` stripped on every model, with curl and with the SDK | No: a request for `google/gemini-3.8-flash` was answered by `mistral/codestral`, and charged | Dropped |
| AICredits (api.aicredits.in) | Yes | Yes: an unknown id is a 400, never a substitute | **In use** |
| AIRouter | not tried | | |

On AICredits with `z-ai/glm-5.3-flash`, every feature the loops need passed: `tools`, `tool_choice: "required"` and by name, two parallel calls in one step, `reasoning_effort`, `response_format: json_schema`, a PNG as an `image_url` part (it read a red/blue test picture correctly), streaming, and cached tokens reported in `prompt_tokens_details`. Each full tool round trip took 1.6–2.4 s.

Prices it lists, in rupees per million tokens at ₹93.96/$ (its own rate, about market):

| Model | In | Out | Vision | One agent run (190k in, 0.7k out) |
|---|---|---|---|---|
| `z-ai/glm-5.3-flash` | 7.4 | 24.7 | yes | **≈ ₹1.4** |
| `qwen/qwen3.8-flash` | 14.8 | 46.4 | yes | ≈ ₹2.8 |
| `deepseek/deepseek-v4.1-flash` | 29.6 | 118 | yes | ≈ ₹5.7 |
| `anthropic/claude-haiku-5.5` | 9.9 | 49.3 | yes | ≈ ₹1.9 |
| `google/gemini-3.8-flash` | 74 | 370 | yes | ≈ ₹14 |
| `z-ai/glm-5.3` | 138 | 434 | yes | ≈ ₹26 |
| `anthropic/claude-opus-5.5` | 376 | 1879 | yes | ≈ ₹73 (₹34 direct with cache reads) |

## The eval

`npm run eval:chat -- --provider openai --model z-ai/glm-5.3-flash [--jobs n] [--out docs/eval/x.json]` runs six fixed jobs through the real chat loop on the demo pump station and scores what a machine can score: whether the answer's ops all land (dry-run), steps, tool errors, tokens, rupees, seconds. Whether the layout is good is the person's half.

First run, GLM-5.3-Flash through AICredits, 2026-11-11 (`docs/eval/2026-11-11-glm-5.3-flash.json`): 6 jobs, 0 failed calls, **0 refused ops in any final answer**, 23 steps, 13 tool errors, 281k+8k tokens, **₹2.28**, 208 s. Four of the six ended in `clarify` or `answer` with an honest reason: the demo screen's body is full ("No room rightOf o17 in the body of s1 for a 200x72 object"), so the layout engine refuses placements and the model, after trying alternatives, says so instead of forcing one. It looked up `PMP_102_RUN` before using it, and told the engineer only a Rectangle has rounded corners. One claim was wrong: asked which tags are bound, it said the project "has no imported tags at all" when it has 20 (none bound); `find_tags` with a five-word query matched nothing and it generalised from that.

The Gemini baseline on the same jobs could not be run from this machine that night: the model list at generativelanguage.googleapis.com answered in 0.6 s but every `generateContent` call hung and ended in `fetch failed` (the `docs/eval/2026-11-11-gemini-3.8-flash.json` rows are those failures). Run it from Vercel or another network before comparing.

**What is not yet known:** whether GLM-5.3-Flash lays out a real project as well as Gemini. The demo fixture has no room, so it tests honesty, not design. The next eval is the one that counts: 3–5 jobs on a real project (Panel-1 or a sample) on each model, judged by a person, with this script's numbers beside the judgment. Until then the gateway is a cost and a transport that work, not a quality claim.

## Which model, decided 2026-11-11

The same six jobs through the real loop on AICredits:

| Model | Failed calls | Refused ops in answers | Edits that landed | Tool errors | Cost | Time |
|---|---|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | 0 | 0 | 2 | 3 | ₹5.04 | **55 s** |
| `z-ai/glm-5.3-flash` | 0 | 0 | 0 | 13 | **₹2.28** | 208 s |
| `qwen/qwen3.8-flash` | 2 | 1 | 2 | 8 | ₹5.04 | 298 s |

MiniMax M3.1-Flash, MiMo-V2.6-Flash and GPT-6-Luna were queued but not run: the key's ₹50 budget ran out (402).

**Default: Claude Haiku 5.5** (`AI_MODEL=anthropic/claude-haiku-5.5`). It finished the work on jobs where GLM gave up, with a quarter of the tool errors, four times faster. At about ₹0.85 a chat turn, a 15-turn project costs about ₹13, inside the ₹30 budget (₹50 ceiling). GLM-5.3-Flash stays in the chat's model menu for cheap work; Qwen and Gemini are there to compare.

The chat header has a model menu (`ModelPicker`, served by `/api/provider` from `web/src/lib/ai/menu.ts`): only models the installation holds a key for, each with its rupees per agent run. The pick is sent with every chat and agent request and mapped on the server, so a browser cannot name a model off the list.

## Opus too

Two ways:

1. **Through the gateway**: `AGENT_MODEL=anthropic/claude-opus-5.5` with `AI_PROVIDER=openai`. The chat stays on GLM, the workspace agent gets Opus, one key. What is lost against the native path: adaptive thinking, prompt caching with a 1-hour TTL, context management (clearing old tool results), and the server-side fallback. At ₹73 per agent run instead of ₹34.
2. **Natively**: `AI_PROVIDER=claude` with `ANTHROPIC_API_KEY`. Everything above is kept, but the chat loses its tool loop (Claude's chat is the single-call path, with a bounded lookup phase).

For the demo and the first paid weeks: GLM-5.3-Flash everywhere, Opus only when a job fails on GLM, by changing `AGENT_MODEL` and nothing else.

## Where the data goes

Through AICredits the request goes **us → AICredits → its upstream host → the model**; the responses name `zai-org/GLM-5.3-Flash`, so there is a host between the gateway and Z.ai. That is fine for development and the eval. Before a customer's engineering file goes through it, that chain has to be stated to them, or the base URL moved to a gateway with a data agreement (Vercel AI Gateway, or Z.ai directly). The switch is `OPENAI_BASE_URL` and the key.
