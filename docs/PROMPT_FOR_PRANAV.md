# Prompt for Pranav's Claude: the full audit, the bug fixes, and the plan for the canvas, the visuals and the knowledge base

Run Claude Code on Opus 5.5 with effort high (`/model`, then `/effort high`), in a fresh clone
of the HMI Copilot repo, and paste everything inside the block below.

Before you start, get these from Shaurya. They are gitignored, and without them about 21 tests
fail and the import audit has nothing real to measure:
- `web/skeleton/` and `web/src/lib/ote/graphics-index.json`
- the engineer projects: `demo_project/HMICopilot_Panel1.eote`, `demo_project/*_4.1.eote`,
  `auto&manua.eote`, `samples/**/*.eote`
- the photos of the real HMI in `images of real hmi/`

These are a client's real projects. Keep them on your machine, out of git, and never upload
them anywhere.

```
You are auditing HMI Copilot, a Next.js app in web/ (repo
https://github.com/shauryaaojha/HMI_Copilot_EcoStruxure, branch main at 7e47382 or later). It
reads and writes EcoStruxure Operator Terminal Expert (OTE) projects (.eote) and Compound
Objects (.co), draws their screens in a browser canvas, and has a Copilot that edits them: a
chat, an agent with about 30 tools (web/src/lib/agent), and an MCP server for claude.ai
(web/src/lib/mcp, /api/mcp, /api/oauth/*). Production is https://hmibuildtimecopilot.vercel.app.

Shaurya wants three things from this session: the deepest audit this codebase has had, design
plans for three changes he believes are needed, and fixes for the bugs the audit finds. Do the
work in two stages:
- Stage 1, the audit (Parts 1 to 6): documents and measurement scripts only. There are no
  edits under web/src in this stage. Push the report the moment it is complete, so Shaurya
  can read it on GitHub while you fix. Shaurya has already given you permission to push it.
- Stage 2, the fixes (Part 7): fix the bugs from BUGS.md, with tests, on a second branch.
  The three designs in Part 6 stay designs. Do not build the nested canvas, the component
  library or the knowledge base in this session.

Use parallel subagents: one per stream below, each with the files it owns and these rules.
You orchestrate, check every claim they bring back against the code, and merge their output.
A finding with no file:line, no repro or no measured number does not go in.

READ FIRST
docs/PLAN_FULL_ARCHITECTURE.md, docs/LLD.md, docs/AUDIT_2026-10.md (the last audit: say which
of its findings are now fixed and which are still open), docs/CO_FORMAT.md,
docs/AGENT_WORKSPACE.md, docs/PLAN_PROJECT_NATIVE.md, docs/RESEARCH_CLAUDE_AI_INTEGRATION.md,
docs/REALTIME_SETUP.md, README.md.

RULES
- Stage 1 goes on a branch audit/2026-11 off main. It may commit only docs/audit/** and
  web/scripts/audit/**.
- Stage 2 goes on a branch fix/audit-2026-11 off audit/2026-11.
- Shaurya allows you to push these two branches to origin. Do not push main, do not
  force-push, do not merge and do not open a PR. Shaurya reviews and merges.
- Never commit web/skeleton/, web/src/lib/ote/graphics-index.json, any .eote that .gitignore
  excludes, or anything taken from them, such as a screenshot of an engineer's screen, a tag
  list or a plant name. In the docs, refer to the engineer projects by file name only.
- Do not change Vercel, Supabase or MongoDB settings. You may read production over HTTP. You
  may create one test account on production to check sign-in, then say which one you made.
- Never print, log or commit a secret. Never read .env files into the docs.
- No Claude attribution in commits: no Co-Authored-By trailer, no "Generated with" line.
- The suite: `cd web && npm ci && npx vitest run` and `npx tsc --noEmit`. Report the real
  counts. On Windows, vitest needs testTimeout 20s.

PART 1. ARCHITECTURE AND EVERY FILE (docs/audit/ARCHITECTURE.md, docs/audit/FILE_MAP.md)
- Read every file in web/src (about 370) and web/tests (about 120). Do not skim.
- FILE_MAP.md has one row per file: what it does, what it imports, what imports it, whether
  it is server, client or shared code, whether any test covers it, and whether it is dead (no
  importers). Generate the import graph with a script, not from memory, and check for cycles.
- ARCHITECTURE.md covers the modules and how data moves through them. Draw a diagram for each
  of: .eote/.co in, the screen model, the canvas, ops, saving, .eote out, and the chat, agent
  and MCP paths. Show where Mongo, GridFS, Supabase Realtime, Vercel Sandbox and Gemini/Claude
  sit in it.
- Mark each place where the docs and the code disagree.

PART 2. CAN AN IMPORTED FILE BE OPENED AND EDITED? (docs/audit/IMPORT_FIDELITY.md)
Shaurya wants a percentage of assurance for each kind of file. Measure it. Do not estimate it.
- Write web/scripts/audit/fidelity.mts. For every .eote and .co you have (tracked and
  gitignored), it must:
  1. read the file with the app's own reader;
  2. list each screen, each part type, each panel model and each driver;
  3. draw each screen with the server renderer;
  4. apply one edit op of each kind (move, resize, set text, set colour, add a part, delete a
     part);
  5. write the .eote back out, read it again, and diff it against what was expected.
- Record what fails at each step, with the error.
- Report the results as a table, one row per file and one row per part type. Each row gives
  the percent that read, drew, took an edit, and survived the round trip. Also give the
  overall numbers, weighted by how often each part type appears in the real projects.
- Shaurya says some panels used by the HMI screens throw errors when they are read. Find
  them. Start from web/src/lib/backend/panels.ts, web/src/lib/ote/reader.ts, struct.ts,
  parts.ts and layout.ts.
  - Give the full list of panel models and part types the real files use.
  - Mark each one supported, partly supported (and what is lost) or unsupported (and the
    error).
  - Say what each fix needs.
- Say plainly what this cannot prove. Whether OTE itself opens our output can only be checked
  in the licensed editor (docs: ote-bench notes in docs/ and tools/). If you have no OTE,
  mark that column "not verified".

PART 3. BUGS (docs/audit/BUGS.md)
- Give each bug a severity (P0 data loss or security, P1 a broken flow, P2 wrong output, P3
  cosmetic), file:line, a repro, what is expected and what happens.
- Where you can, prove it with a failing test under web/scripts/audit/. Do not put that test
  in web/tests.
- Look hardest at:
  - the .eote writer (anything that corrupts or drops data on save);
  - ops/apply under concurrent edits;
  - authorisation on every /api route: who can read or write whose project, share links,
    upload, picture;
  - the OAuth server and the MCP tools;
  - the agent's tools and its Sandbox;
  - realtime token minting;
  - the input limits on every route.

PART 4. FEATURE STATUS: WHAT IS REALLY DONE (docs/audit/FEATURE_STATUS.md)
Answer each of these with yes, partly or no, and the evidence for it (code, test, or a live
check on production).
- Accounts:
  - sign up, sign in, sign out;
  - a session surviving a reload;
  - changing a password, resetting a forgotten one, verifying an email;
  - deleting an account;
  - rate limiting and lockout on sign-in and sign-up;
  - that /signin's next= cannot redirect off-site.
  Sign-ups are open to anyone right now: say what that exposes.
- The claude.ai MCP connector, against the current MCP authorization spec and Anthropic's
  connector docs (fetch them and quote the URLs):
  - protected-resource and authorization-server metadata;
  - dynamic client registration;
  - authorize with PKCE, and the consent screen;
  - the token endpoint, refresh and revoke;
  - the personal-access-token fallback;
  - every tool in web/src/lib/mcp/tools.ts.
  Run it with the MCP Inspector against a local server, and against production if you can sign
  in. Give one verdict, as a percentage of the spec's MUSTs that are met, then list the rest.
  It has not yet been tried from a real claude.ai account: say so.
- Alignment and bug fixes from the agent chat. Shaurya believes these do not work.
  - Check which agent and chat tools can align, distribute, match size, snap to the grid,
    remove overlaps and fix out-of-bounds parts.
  - Then run real prompts on a real screen: "align the start and stop buttons", "these
    labels overlap, fix it", "make this screen tidy".
  - Record what the agent did, and whether the geometry is now right (measured, not judged
    by eye). Note anything caused by Gemini quota limits.
- Live sync (Supabase Realtime, with SSE as the fallback), comments, share links, history and
  undo, and export.

PART 5. USER FLOWS AND GAPS (docs/audit/USER_FLOWS.md, docs/audit/GAPS.md)
- Walk the app as each of these users, on production and locally, and write down every step,
  every dead end, every unclear label and every error message:
  - a first-time engineer with an existing .eote;
  - an engineer starting from a plant brief;
  - a reviewer on a share link;
  - a claude.ai user using the connector.
- For each flow, add a section "how the user could think about this differently": where the
  app makes them think in our terms rather than theirs (screens, tags, PLC symbols, alarms,
  the panel), and what a flow built around their job would look like.
- GAPS.md lists what an OTE engineer needs that the app does not do yet, ranked by how much it
  blocks real use.

PART 6. THREE DESIGNS (docs/audit/DESIGN_*.md)
For each design: the problem with evidence, the design, the data structures as TypeScript
types, what changes in which files, the risks, a phased plan with tests, and the open
questions for Shaurya. Design them only; do not build them.

A. Nested canvas and a grid the AI can do geometry on (DESIGN_NESTED_CANVAS.md).
   - Shaurya's idea is a tree, like a DOM:
     - one project canvas that holds every screen and Compound Object;
     - inside each screen, its own canvas at the panel's pixel size, with a fixed pixel grid;
     - the AI reads that tree as numbers (boxes, gaps, rows, columns, alignment groups), works
       out the geometry, and returns exact ops to fix the alignment.
   - Check the idea against the current canvas (web/src/components/canvas,
     web/src/lib/ote/layout.ts, tidy.ts, place.ts), then design it.
   - Cover:
     - the coordinate spaces and how they convert;
     - how a CO's own inner canvas nests in a screen;
     - the grid unit;
     - the layout facts the AI is given (a constraint list, not a picture);
     - a solver that does the maths in code, so the model never does pixel arithmetic in its
       head;
     - how the agent tools call it;
     - how a fix is checked before it is applied.

B. Better-looking screens (DESIGN_SCREEN_VISUALS.md).
   - Shaurya finds the screens we generate sharp and ugly.
   - Compare our output with the photos in `images of real hmi/`, the installed and downloaded
     Pro-face COs, and ISA-101 / high-performance HMI practice.
   - Design a component library the generator and the agent pick from:
     - tank, pump, valve, motor, trend, gauge, bar, alarm banner, nav bar and status tile;
     - each with its variants, sizes, states and colour tokens.
   - Every component must still be made of parts OTE can open. Say how each one maps to OTE
     parts or to a .co.

C. An indexed knowledge base the AI builds screens from (DESIGN_KNOWLEDGE_BASE.md).
   - Start from what exists (web/src/lib/knowledge, web/.knowledge, graphics-index.json,
     exemplars.ts, the docs).
   - Design one index of OTE part types and their properties, the components from B, layout
     patterns, ISA-101 rules, panel models and sizes, driver and tag conventions, and worked
     examples from real screens.
   - Cover how it is stored, how it is versioned, and how the agent and the MCP server look
     things up (by id, by tag, by search).
   - Cover how it stays true to the code: generated from the code where it can be, and checked
     by a test.

THE REPORT (docs/audit/00_INDEX.md), WHICH ENDS STAGE 1
Put it on one page, with a link to every other file. Include:
- the suite and tsc counts;
- the five worst bugs;
- the fidelity table;
- the verdicts on accounts, MCP and agent alignment;
- the top gaps;
- a recommended order of work for the next sprint, with sizes (S/M/L).
Commit it and push audit/2026-11 straight away, before you start Stage 2. Shaurya reads it
there. Then post in the chat:
- the GitHub link to docs/audit/00_INDEX.md on that branch;
- the commit;
- the test account you made.

PART 7. FIX THE BUGS (Stage 2, branch fix/audit-2026-11)
- Fix every P0 and P1, then as many P2s as the session allows. Order them by severity, then by
  how many users each one hits. These count as bugs, so fix them in this stage:
  - panels and part types that throw when read: give each one at least a safe read that keeps
    the data and draws a placeholder, instead of an error;
  - agent and chat tools that claim to align or tidy but leave the geometry wrong.
- One bug, one commit. The message says what was wrong and what is true now. Put no Claude
  attribution in it.
- Each fix comes with a regression test in web/tests. That test fails before the fix and
  passes after it. Move the matching failing test from web/scripts/audit/ into it.
- Run the full suite and tsc after every fix. A fix that breaks another test is not done.
- Run web/scripts/audit/fidelity.mts again at the end. Add its before and after numbers to
  IMPORT_FIDELITY.md.
- Do not touch the .eote writer's output format, the OAuth or MCP wire format, or anything
  that needs a Vercel, Supabase or Mongo setting changed. List those fixes in BUGS.md as
  "needs Shaurya", with the exact change each needs.
- Some fixes really need a design from Part 6, for example the real alignment solver. Fix the
  current bug as far as the current code allows, then mark it "full fix in DESIGN_x".
- Keep BUGS.md current. Each bug's status is one of: fixed (with the commit), needs Shaurya,
  needs design, or won't fix (with why). Commit that on the fix branch.
- Push fix/audit-2026-11 after each few fixes, so Shaurya can follow along.
- Finish with a short report:
  - what was fixed;
  - what was left, and why;
  - the suite and tsc counts before and after;
  - the fidelity numbers before and after;
  - the branch and its last commit.
```
