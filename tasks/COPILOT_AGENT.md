# The Copilot as an agent - handoff

Owner: Antik (with Claude Code). Reviewer: Shaurya's Claude, who will pull `copilot-agent`, read every diff, run the checks below, and run the comparison in Part E against `main` before anything reaches `main`.

Baseline: branch `copilot-agent` starts at `main` commit `91503bb`. Shaurya will compare what is built here against that baseline twice: as code (`git diff main...copilot-agent`) and as behaviour (the eval in Part E, run on both). Keep the old path working so the second comparison is possible.

## Setup on a fresh machine
```
git fetch origin && git checkout copilot-agent && git pull
cd web && npm ci
```
The project skeleton (`web/skeleton/`) and `src/lib/ote/graphics-index.json` are Schneider's files and are not in the repository; tests that need them skip themselves. For the agent you need a model key in `web/.env.local` (never commit it, never print it): `AI_PROVIDER=claude` + `ANTHROPIC_API_KEY=...` for the main path, or `AI_PROVIDER=gemini` + `GEMINI_API_KEY=...` for the fallback. Run tests with `MONGODB_URI` unset so nothing writes to the shared database.

---

Work in the `web/` folder of this repository (Next.js 15, React 19, TypeScript, zustand, Tailwind 4, vitest), deployed on Vercel. Branch `copilot-agent`.

# Goal

Today a chat turn is one model call: the model picks a mode (build, extend, edit, answer, clarify, startOver), returns a list of ops, the client dry-runs them, asks once more if some were rejected, and commits or proposes. It cannot look at the result of what it did, so it cannot notice that an edit failed on two screens, that a build left a unit without a faceplate, or that a fix created a new overlap.

Make the Copilot an **agent**: within one turn it plans, calls tools, reads what they return, and keeps going (look, change, check, fix) until the request is done or it has to ask. Every change it makes is still an `Op` applied by `applyOps`, so the canvas, undo, versions, proposals and shared projects keep working exactly as now.

# Read first, in this order

1. `src/lib/ai/converse.ts` - the current turn: `SYSTEM`, the digest (`digestOf`, `projectContext`, `volatileContext`), the op schema (Gemini and JSON Schema), `converse()`.
2. `src/lib/ai/ops.ts` - the Op language, `coerceTurn`, `buildsInstead`.
3. `src/lib/ai/expand.ts` - the scope of an op: `screens` (`["all"]` or names/handles), `select` (background, header, title, navigation, footer, alarms, or a part type), `selectText`. One op becomes one plain op per object.
4. `src/lib/ai/applier.ts` - `applyOps`, `dryRun`, `commit`, `previewOf`; the cases for every op, including `tidyLayout` (overlaps, via `src/lib/ote/tidy.ts`), `moveObject` (`dx`/`dy`, moves a faceplate whole), `alignObjects` (asks which way when no mode), `addAlarm` (upsert).
5. `src/components/chat/useChat.ts` and `src/components/chat/ChatPanel.tsx` - the client side of a turn: ask, dry run, repair, commit or propose; how a turn record is shown; `src/components/chat/shared.ts` for shared projects (screen lock, server-side build, proposals).
6. `src/app/api/chat/route.ts` and `src/lib/ai/provider.ts` (provider choice, `AI_PROVIDER`), `src/lib/ai/model-error.ts` (how model failures are worded).
7. `src/lib/ai/pipeline.ts` and `src/components/generation/useGeneration.ts` - building screens from tags (plan scope whole/named/unrelated, `finishPlan`, `placeEveryUnit`).
8. `src/lib/agent/loop.ts` and `bin/hmi.mts` - the existing CLI agent (`hmi agent`: build, check, repair rounds, optional OTE bench). Reuse its `check()`.
9. `src/lib/validation/rules.ts` (`validateProject`), `src/lib/critic/geometry.ts` (`critiqueScreens`), `src/lib/ote/tidy.ts` (`overlapsOn`).
10. Tests to imitate: `tests/expand.test.ts`, `tests/tidy.test.ts`, `tests/conversation.test.ts`, `tests/planner.test.ts`.

Vercel facts that decide the design: functions are stateless and short-lived (no process that lives across requests, no WebSockets); secrets live in env vars; use `waitUntil` for work after the response.

# Decisions already made

1. **Where the loop runs: model on the server, tools in the client, one HTTP request per step.**
   The project lives in the browser (zustand store; for shared projects, also on the server as a snapshot). So: `POST /api/agent/step` takes the conversation so far (messages including previous tool calls and tool results) and returns the model's next message: either tool calls, or a final answer. The client executes the tool calls against a **scratch copy** of the project (the same scratch store `dryRun` uses), appends the results, and calls the step again. No request outlives one model call; nothing is kept on the server between steps. This works on Vercel, locally, and for shared projects.
   - Do **not** add `@anthropic-ai/claude-agent-sdk`: it drives the Claude Code CLI as a subprocess with a filesystem, which a Vercel function cannot host. Use `@anthropic-ai/sdk` (already a dependency) Messages API tool use, with the loop written by us. Use `@google/genai` function calling for the Gemini fallback. No other new dependencies.
2. **Model.** Claude is the main path: `AI_PROVIDER=claude`, model from `resolveProvider()` (default `claude-opus-5-5`; allow `AI_MODEL` override, for example `claude-sonnet-5-5` for cost). State effort explicitly on every call. Use prompt caching on the system prompt and tool definitions (they are the same every step). Gemini is the fallback with the same tools; it will be weaker at long loops and that is acceptable.
3. **Feature flag, old path kept.** `AGENT_MODE=on|off` (env, default `off` on this branch until the eval passes; the reviewer will flip it). With `off`, everything behaves exactly as `main` does today. The chat panel shows which path answered (a small "agent" badge on agent turns). This is what makes the side-by-side comparison possible.
4. **One turn = one commit.** All tool writes in a turn go to the scratch store. When the agent finishes, the turn ends the way an edit turn does today: committed as one version (one undo step, one "revert to here"), or offered as a proposal when the existing rules say so (destructive ops such as deleting; any write in a shared project, through `proposeShared`). A turn the user stops, or that hits a limit, offers what was done so far as a proposal, never a silent half-commit.
5. **Limits.** At most 12 steps per turn and at most 60 tool calls; per-step token cap; total turn timeout 120 s client-side. When a limit is hit, stop, show what was done, and say what is left. A Stop button in the chat stops after the current step.
6. **Visible work.** Each step streams into the chat turn as short lines, in the engineer's words, like the build timeline: "Looked at s3 Boilers: 2 overlaps", "Set the background brown on 12 screens", "Validated: 0 errors, 3 warnings", "Moved Card_GRD201 clear of Card_GRD202". The model's own reasoning is not shown. The final reply is one or two sentences plus the change list.
7. **Tools.** Every tool has a JSON Schema input, a description written for the model, and returns compact JSON (never the whole project). Read tools never change anything. Write tools go through `applyOps` on the scratch store, so every rule already in the applier (scope expansion, faceplates moving whole, alarm upsert, name uniqueness, palette) applies. Minimum set:

   | Tool | Kind | What it does |
   |---|---|---|
   | `get_project` | read | name, panel, screens (handle, name, level, object count, equipment ids), tag count, alarm count, unresolved validation counts |
   | `get_screen` | read | one screen's objects: handle, name, type, region, box (left, top, width, height), bound tag, group/card membership, text; plus its overlaps and free room |
   | `find_objects` | read | `select`/`selectText`/`screens` as in expand.ts, returns matches with handle, screen and box; for "which objects show PMP_101", "every lamp on Boilers" |
   | `search_tags` | read | tags by name/comment/role query, with data type and comment; for tags not in the digest |
   | `get_alarms` | read | alarms, optionally for one tag |
   | `validate` | read | `validateProject` + `critiqueScreens` on the scratch state; findings with rule, severity, object handle, message; optional screen filter |
   | `apply_ops` | write | the existing Op language (including `screens`, `select`, `tidyLayout`, `dx/dy`), executed on the scratch store; returns applied lines, rejections with reasons, created handles, renames |
   | `build_screens` | write | runs the generation pipeline (whole, named or extend, exactly the rules `main` has) into the scratch store; returns screens added, units placed, alarms, bindings, and any decline ("request does not match this tag list") |
   | `undo_last` | write | reverts the scratch store to before the previous write tool call in this turn |
   | `ask_user` | control | ends the turn with one or two questions (the current clarify behaviour) |
   | `finish` | control | ends the turn with the reply; the client then commits or proposes |

   Optional, local only (hidden when `process.env.VERCEL` is set): `bench_in_ote` - export the scratch state and run `hmi bench` against the licensed editor, returning open/simulate results. Only if it is straightforward; say in the report if skipped.
   `build_screens` needs the generation events applied to a store other than the live one: refactor `useGeneration`'s `apply(event)` into a function that takes a store, and use it for both.
8. **System prompt.** Write a new agent system prompt (keep `SYSTEM` for the old path). Carry over everything the current prompt teaches that still applies (ISA-101, palette names, scope examples, overlaps, clarify rules: ask instead of building a different plant than the tag list describes, a request naming particular equipment builds only that) and add the working method: look before changing, change with the fewest ops (one op with `screens: ["all"]`, never twelve), validate after changing, fix what the change broke, stop when done. Never invent handles: if you do not know one, call `get_screen` or `find_objects`.
9. **Context per step.** Send the compact project summary (what `digestOf` gives) once at the start of the turn as the first user message; later state comes from tool results. Keep previous turns as the structured history the old path already keeps (`HistoryItem`), not raw tool transcripts, so a long session does not grow without bound.
10. **Errors.** A model failure mid-turn (overloaded, quota, key) is worded with `describeModelError` and ends the turn offering what was done so far. A tool that throws returns `{ error }` to the model rather than ending the turn.
11. **Rules for the whole task.** Commit in logical steps on `copilot-agent` and push it; never merge into or push `main`; never add a `Co-Authored-By: Claude` trailer or a "Generated with Claude Code" line to any commit or PR - the repository owner's rule; no changes to `src/lib/ote/**` or the .eote format beyond what `build_screens`'s store refactor strictly needs (say so if any); do not weaken or delete existing tests; never print or write secrets.

==================================================================
# PART A - the step route and the loop
==================================================================
- `src/lib/agent/tools.ts`: tool definitions (name, description, JSON Schema) shared by both providers; one source of truth, converted to Anthropic `tools` and Gemini `functionDeclarations`.
- `src/lib/agent/step.ts`: one model call for each provider, given messages and tools; returns `{ toolCalls: [{ id, name, input }] } | { final: string }` plus usage. Pure server code, no store.
- `src/app/api/agent/step/route.ts`: validates the body (size limit, message count limit), checks `AGENT_MODE`, calls `step`, returns JSON. Same CSRF/origin guard the other POST routes use (`json()`/`sameOrigin`). `maxDuration` for one model call.
- `src/components/chat/agent/executor.ts` (client): runs tool calls against the scratch store; returns results; keeps the list of applied lines and the snapshot stack for `undo_last`.
- `src/components/chat/agent/useAgentTurn.ts` (client): the loop (step, execute, step, ...), limits, stop, streaming lines into the turn, final commit or proposal through the existing functions.
- `useChat.ts`: when `AGENT_MODE` is on (exposed to the client through `/api/provider` or a small config route, not a `NEXT_PUBLIC_` secret), a turn goes to `useAgentTurn`; otherwise unchanged.

==================================================================
# PART B - tools
==================================================================
Implement every tool in the table. Each returns compact JSON; cap list sizes (for example 80 objects per `get_screen`, with a "truncated" flag) so a big screen cannot blow the context. `apply_ops` reuses `coerceTurn`'s op validation. `validate` runs on the scratch state, not the live one.

==================================================================
# PART C - the chat experience
==================================================================
- Agent turn in `ChatPanel`: the step lines as they arrive, then the reply and the change list (applied, rejected with reasons), the "agent" badge, step count and token usage, the Stop button while running, and the existing "revert to here" once committed.
- Proposals: an agent turn that ends as a proposal uses the existing proposal UI (Apply n of m / Discard).
- Shared projects: take the screen lock at the start of the turn as today, release it at the end; the result is a proposal for everyone (Phase D rules unchanged).

==================================================================
# PART D - tests
==================================================================
- `tests/agent-tools.test.ts`: every tool against fixture projects (use `layoutApplication` + `inferEquipment` as `tests/expand.test.ts` does): read tools return what is there; `apply_ops` with `screens: ["all"]` and `select`; `undo_last`; `validate` on scratch state; `build_screens` named/whole/unrelated.
- `tests/agent-loop.test.ts`: the loop with a **scripted fake model** (no network): a script of tool calls per step. Cover at least: "background brown on all screens" (one apply_ops, finish, committed once); "fix the overlapping" after an overlap is created (get_screen sees overlaps, apply_ops tidyLayout, validate shows none, finish); a rejected op followed by a corrected one; step limit reached (offers a proposal); a model error mid-turn; `ask_user`; a destructive op ending as a proposal.
- `tests/agent-route.test.ts`: the step route refuses when `AGENT_MODE=off`, refuses oversize bodies, and converts tools for both providers (snapshot the converted tool lists).
- All existing tests still pass, unchanged.

==================================================================
# PART E - the comparison (this is what the reviewer will look at)
==================================================================
Write `scripts/agent-eval.mts`: runs a fixed list of requests against a fresh project made from a sample tag file, once through the **old path** (`/api/chat` + dry run/commit, as `useChat` does today, driven headlessly) and once through the **agent path**, and writes `tasks/COPILOT_AGENT.eval.md`: per request, for both paths, the screens and object counts after, applied/rejected counts, validation errors/warnings after, overlaps after, model calls and tokens, wall time, and the final reply. Use real model keys from env; skip with a clear message when none is set.

The request list (tag files are in `samples/`):
1. coffee-machine: "build all the screens"
2. coffee-machine: "change the background to brown on all screens"
3. coffee-machine: "make the screen title font 20 on every screen"
4. coffee-machine: "Build one screen for the two boilers showing heating, ready, brew water temperature against setpoint, steam pressure and steam boiler level, with a low level alarm." (after 1)
5. coffee-machine: "move the Crusher 201 faceplate 180 pixels to the right" then "fix the overlapping"
6. coffee-machine: "align the lamps on this screen to the top"
7. coffee-machine: "remove the footer from every screen"
8. microwave-tunnel: "build the screens for a car wash" (must not build; must ask)
9. microwave-tunnel: "make one screen with only the two microwave leakage monitors"
10. microwave-tunnel: the whole-application prompt from `samples/microwave-tunnel/README.md`, then "check every screen and fix whatever the validation finds"
11. transfer-pump-station: "add a high alarm on the break tank at 85 percent"
12. any sample: "what does this project have?" (answer only, nothing changes)

The agent path is expected to match or beat the old path on every row; where it does worse, say why in the report.

==================================================================
# Checks before finishing (after each part, not only at the end)
==================================================================
`npx tsc --noEmit -p .`, `npx vitest run` (with `MONGODB_URI` unset), `NEXT_DIST_DIR=.next-build npx next build` then `git checkout -- next-env.d.ts tsconfig.json`.

# Finish
Write `tasks/COPILOT_AGENT.report.md` and commit it with the last part: files and routes added or changed, the vitest totals line after each part and at the end, the build result, the eval table from Part E (or why it could not run), any change to `src/lib/ote/**` and why, and anything unsure, skipped or left out. Push `copilot-agent`. Do not open a PR to `main` and do not merge.
