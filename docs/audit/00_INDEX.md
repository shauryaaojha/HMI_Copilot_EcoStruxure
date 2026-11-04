# HMI Copilot audit, November 2026: the report

> **Stage 2 (fixes):** see [STAGE2_REPORT.md](STAGE2_REPORT.md) on branch `fix/audit-2026-11`. Each bug's status is in [BUGS.md](BUGS.md).

*Branch `audit/2026-11`, off `main` at `5fd701d`. Written 4 November 2026 by Pranav's Claude (Claude Code, Opus 5.5, effort high), following the brief in [docs/PROMPT_FOR_PRANAV.md](../PROMPT_FOR_PRANAV.md).*

*The work ran in six parallel streams, each reading its own files in full:*
- *S1: format, model and ops*
- *S2: server and security*
- *S3: MCP and agent*
- *S4: client and user flows*
- *S5: canvas, plus designs A and C*
- *S6: visuals, design B*

*Every finding was then checked against the code before it went in. A finding with no file:line, no repro and no measured number was left out.*

## The files

| File | What it holds |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Modules, data flow, a diagram per path (`.eote`/`.co` in, screen model, canvas, ops, saving, `.eote` out, chat, agent, MCP), where Mongo, GridFS, Supabase, Sandbox and Gemini/Claude sit, and every place the docs and the code disagree |
| [FILE_MAP.md](FILE_MAP.md) | One row for each of the 476 files in `web/src` and `web/tests`: what it does, imports, importers, server/client/shared, test reach, dead or not. The generated columns come from `web/scripts/audit/graph.mts` |
| [IMPORT_FIDELITY.md](IMPORT_FIDELITY.md) | Measured read / draw / edit / round-trip percentages per file and per part type, the panel models and part types the real files use, and what each fix needs |
| [BUGS.md](BUGS.md) | 82 bugs with severity, file:line, repro, expected, actual, proof and status |
| [FEATURE_STATUS.md](FEATURE_STATUS.md) | Accounts, the claude.ai connector against the MCP spec, agent alignment measured, live sync, comments, share links, history and export |
| [USER_FLOWS.md](USER_FLOWS.md) | Four users walked step by step, each with "how the user could think about this differently" |
| [GAPS.md](GAPS.md) | 16 things an OTE engineer needs that the app does not do, ranked by how much each blocks real use |
| [LAST_AUDIT.md](LAST_AUDIT.md) | Each AUDIT_2026-10 finding: fixed or still open, with evidence |
| [DESIGN_NESTED_CANVAS.md](DESIGN_NESTED_CANVAS.md) | Design A: the canvas tree, the grid, and a solver the AI hands constraints to |
| [DESIGN_SCREEN_VISUALS.md](DESIGN_SCREEN_VISUALS.md) | Design B: a component library made only of parts OTE can open |
| [DESIGN_KNOWLEDGE_BASE.md](DESIGN_KNOWLEDGE_BASE.md) | Design C: one indexed knowledge base, generated from the code where it can be |

Scripts and proof tests are in `web/scripts/audit/`:
- `graph.mts`: the import graph
- `fidelity.mts`: the import fidelity rig
- `s1-*` to `s6-*`: the failing proof tests and the measurement scripts
- `vitest.config.mts`: the separate config the proof tests run under

## The suite and tsc

| Run | Result |
|---|---|
| `npx vitest run` (`web/`, testTimeout 20 s) | **110 files, 1461 passed, 9 skipped, 0 failed** with a local server up. At baseline, with no server: 1446 passed, 24 skipped. The 15 extra skips are `tests/demo-path.test.ts`, which needs a running app. |
| The 9 remaining skips | 6 are correct environment gates (no OTE install, no Vercel Sandbox token, `MONGODB_URI` empty on purpose). 3 can never run on any machine but Shaurya's: they hard-code `C:/Users/shaur/Downloads/...` ([S1-15](BUGS.md#s1-15)). |
| `npx tsc --noEmit` | **0 errors** on a clean tree. A stale `web/.next-build/` gave 3 errors at baseline, because `tsconfig.json` includes its types ([S0-01](BUGS.md#s0-01)). |
| Audit proof tests (`npx vitest run --config scripts/audit/vitest.config.mts`) | **62 failing tests in 33 files**, every one for its bug's stated reason. 7 control cases pass on purpose. |

## The five worst bugs

| # | Bug | Why it is worst |
|---|---|---|
| 1 | [S1-03](BUGS.md#s1-03) **P0**. Editing one tag resets every other variable's `InitialValue` to the type default (`lib/ote/databases.ts:140-143`) | Silent data loss in the engineer's own project, on the most common edit there is. 22 variables in each engineer file carry a value it would destroy. |
| 2 | [S3-01](BUGS.md#s3-01) **P0**. Connector token scopes are recorded and never enforced, so a read-only token can write (`lib/mcp/caller.ts:92`, read nowhere) | Security. A grant for "read" from claude.ai is a grant for "write". Proven live: a proposal was queued with an `mcp:read` token. |
| 3 | [S1-01](BUGS.md#s1-01) **P1**. The export route refuses, with a 409, any project that holds a Compound Object (`lib/backend/types.ts:165-178`) | 3 of the 4 real engineer files cannot be exported at all. On those files only 19.8 % of edits end in a file the user can download. |
| 4 | [S4-01](BUGS.md#s4-01) **P1**. Reopening a project shows the "New project" start pane over it, with no way out (`components/shell/Workspace.tsx:52-63`) | Every user, every day. The pane is decided once, before a server project has loaded. |
| 5 | [S2-02](BUGS.md#s2-02) **P1**. The routes that call the model (`/api/chat`, `/api/generate`, `/api/agent`, `/api/critique`, `/api/brief/draft`, `/api/tags/match`) need no sign-in and have no rate limit | Anyone on the internet can spend the one shared Gemini key. When it runs out, chat, generate, agent and connector stop for everyone. 50 of 50 anonymous calls reached the model. |

Close behind:
- [S3-10](BUGS.md#s3-10): one anonymous POST that renders a screen 50 px tall or less makes resvg panic and kills the whole Node process.
- [S1-05](BUGS.md#s1-05) (P0, rare): a carried binding can be silently retargeted onto another part. There were 0 cases in this corpus.
- [S2-01](BUGS.md#s2-01): `/signin?next=/\evil.example` redirects off-site.

**Bug totals: 82.** P0 3, P1 12, P2 39, P3 28. 4 duplicates across streams were merged.

## Import fidelity (measured, not estimated)

`fidelity.mts` ran on 15 files: 4 `.co`, 6 tracked `.eote` and 5 gitignored engineer `.eote`. Two of the engineer files are the same bytes. Each step uses the app's own reader, server renderer, `core/ops` and writer.

| | Read | Drew | Took the edit | Survived write + re-read | Survived, and export lets it out |
|---|---|---|---|---|---|
| Weighted by part-type frequency in the real projects (591 objects) | **98.4 %** | **99.3 %** | **98.9 %** | **95.8 %** | **66.1 %** |
| The 4 distinct engineer files (207 ops) | | | 98.6 % | 88.9 % | **19.8 %** |
| Tracked `.eote` (6 files) | 100 % | 100 % | 100 % | 94.0 to 100 % | all accepted |
| `.co` (4 files) | 4/4 | 4/4 | 4/4 | 4/4 byte-identical | n/a |
| OTE opens our output | **not verified**: OTE Expert is not installed on this machine |

- **The panels that throw errors on read.** Nothing threw on these 15 files.
  - The likeliest match for the report is the **MasterScreen**. It is not in the screen schema, so it is carried whole, and every screen draws without its header frame ([S1-10](BUGS.md#s1-10)).
  - The engineers' panel, **HMIST6600** (1280x800), is not in `PANELS` ([S1-14](BUGS.md#s1-14)).
  - `HardwareConfiguration` and `DateTimeDisplay` (both on the master screen) are not read.
- **Bound types** (NumericDisplay, Lamp, Switch and the like) are partly supported: deleting one damages other bindings ([S1-04](BUGS.md#s1-04)).
- The per-file and per-type tables are in [IMPORT_FIDELITY.md](IMPORT_FIDELITY.md).

## Verdicts

| Area | Verdict |
|---|---|
| **Accounts** | **Partly.** Sign up, sign in, and a session that survives a reload all work (checked locally; there is no production account, see below). No password change, no reset, no email verification, no account deletion. Sign-out leaves a copied cookie valid for 30 days ([S2-15](BUGS.md#s2-15)). A stranger can lock any account out ([S2-05](BUGS.md#s2-05)). `next=` can redirect off-site ([S2-01](BUGS.md#s2-01)). Open sign-up gives anyone unlimited unverified accounts with no storage quota ([S2-07](BUGS.md#s2-07)), but no route lets one read another person's project without a membership or a link. |
| **claude.ai MCP connector** | **31 of the 35 server-side MUSTs that apply are met (89 %)**, checked against MCP 2026-07-28, OAuth 2.1 draft-13 and claude.com/docs/connectors/building/authentication. The full OAuth flow was driven by hand on a local server, and all 10 tools were called through the MCP Inspector CLI. Production metadata is correct. Not met: scopes are not enforced ([S3-01](BUGS.md#s3-01)); codes and refresh tokens are not bound to their client ([S3-05](BUGS.md#s3-05)); RFC 7591 error codes. **It has not yet been tried from a real claude.ai account.** |
| **Agent and chat alignment** | **Chat: partly. Agent: no.** "Align the start and stop buttons": vertical-centre gap 10 -> 0 px, correct. "These labels overlap, fix it": overlap 1680 -> 0 px², correct. "Make this screen tidy": overlap 2920 -> 1240 px²; the buttons were not aligned, and 3 overlaps inside a card were left while it reported done ([S3-09](BUGS.md#s3-09)). There is no op for match size, snap to grid or an already out-of-bounds part. The agent has no geometry tool at all. All 3 agent runs stopped on Gemini 503 "high demand"; the chat path saw no 429s. |
| Live sync | **Partly.** Edits sync between tabs, and the SSE fallback works. Four of the five server write paths send no Realtime notice ([S2-04](BUGS.md#s2-04)). Proposals and agent steps never reach a Realtime tab ([S4-22](BUGS.md#s4-22)). |
| Comments, share links | **Yes.** Comments refresh by a 10 s poll. Commenter and editor links default to allowing export ([S4-18](BUGS.md#s4-18)). |
| History and undo, export | **Partly.** Restoring the oldest version does nothing ([S4-02](BUGS.md#s4-02)). Export files are produced, but the CO 409 blocks most real projects and the "verified" badge overclaims ([S4-17](BUGS.md#s4-17)). |

## The top gaps

1. **A project cannot be reliably reopened** (bug S4-01; everyone, every day).
2. **Changes made on the server never reach the open tab**, and the conversation is lost on reload.
3. **No blank-screen path**: the three ways in are a tag export, a brief or a file.
4. **The plant vocabulary is nine kinds**: no mixer, compressor, blower, heat exchanger or analyser.
5. **No site tag convention**: placeholders are always `<PREFIX>_<NNN>_<SIGNAL>`.
6. **No review or sign-off workflow** for a reviewer.
7. **The connector cannot be discovered** in the app, and it **cannot bring a project in or out** (no open, import or export tools).

The other nine are ranked in [GAPS.md](GAPS.md).

## Recommended order for the next sprint

S = under a day, M = one to three days, L = a week or more.

| # | Work | Size | Bugs |
|---|---|---|---|
| 1 | Stop the writer destroying data. Keep each variable's own `InitialValue`. Leave untouched binding rows byte-identical. Drop the binding rows of a deleted part. | S | S1-03, S1-02, S1-04 |
| 2 | Enforce connector scopes: read tools only with `mcp:read`, writes need `mcp:write`, and answer 403 `insufficient_scope` | S | S3-01 |
| 3 | Decide the start pane after the project has loaded | S | S4-01 |
| 4 | Close the off-site redirect, and guard `/api/knowledge` | S | S2-01, S2-06 |
| 5 | Refuse renders under the size resvg survives, and cap the agent's regex search | S | S3-10, S3-07 |
| 6 | Export projects that hold Compound Objects | M | S1-01 |
| 7 | Sign-in and a per-user rate limit on the model routes (Shaurya decides whether anonymous demo use stays) | M | S2-02, S2-05 |
| 8 | Every write path announces its revision; proposals and agent steps travel over Realtime | M | S2-04, S4-22, S4-23 |
| 9 | Accepting a proposal rebases onto the current state instead of overwriting it | M | S1-06 |
| 10 | Model the MasterScreen and add HMIST6600 | M | S1-10, S1-14 |
| 11 | Design A phase 1: the read model and the constraint solver behind `align`/`tidy`, then give the agent the same tool | L | S3-03, S3-09, S5-02, S5-06 |
| 12 | Design B phase 1: tokens, then Pump, Motor, Valve and StatusTile, starting with the single-drive motor screen | L | S6-01, S6-03, S6-04 |
| 13 | Design C phase 1: the generated public layers of the index and its staleness test | M | |
| 14 | Accounts: password change, reset and deletion (reset needs an email vendor: Shaurya's call) | M | |

## What this audit could not check

- **Whether OTE opens our output.** OTE Expert is not installed on this machine. That column says "not verified" everywhere.
- **Anything on production that needs a signed-in session or a POST.** The permission system on this machine refused the one test-account sign-up on production. So every production check was a read-only GET, and **no production test account was made**. Signed-in checks ran on a local production build (`next start`) with the file store.
- **Supabase policy behaviour, the Mongo 16 MB document limit, and Vercel's handling of X-Forwarded-For and the 4.5 MB body cap.** These were judged from code; production settings were not touched.
- **A real claude.ai account using the connector.**
- **The photos in `images of real hmi/`.** None of them shows an operator screen: they show the training rig, a placard and the panel's download screen. Design B used them for patterns only, and measured the client's own screens in `HMICopilot_Panel1.eote` for counts.
- **Agent prompts 2 and 3** were never sent: Gemini returned 503 on all three agent attempts.

Client data: no screenshot, tag, screen name, text or plant name from the engineer projects is in this report. Every output was checked before commit against a deny-list of all 3,049 strings in those files.
