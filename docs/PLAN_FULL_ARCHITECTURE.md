# Full plan: module split, claude.ai integration, Supabase, and tags-free generation

Written 2026-10-29. Covers everything still open: the split (PLAN_SERVICE_SPLIT.md), the claude.ai connector (RESEARCH_CLAUDE_AI_INTEGRATION.md), moving storage and live sync to Supabase, and how screens get built when there are no tags. Each claim is marked **verified** (checked in code or in a source fetched today) or **to verify** (needs checking before it is relied on).

## 0. Where things stand

- **Branches.** `origin/feat/screens-first` (Pranav's work, 2 commits) is based on `fix/imported-fill` (the Fill fix). Pranav's branch is reviewed and green. **Verified.**
- **Uncommitted on `review/screens-first`.** Adoption bug fixes, the screen-delete cascade fix, `web/src/lib/refs/`, three test files, and the docs (PLAN_SERVICE_SPLIT, RESEARCH_* x2, this plan). **Verified** with `git status`.
- **Tests.** Full suite 1184 passing, 17 skipped, typecheck clean. **Verified** on the last run.
- **Storage today.** MongoDB for metadata, the op log and membership (`lib/server/repo.ts`, `lib/server/storage.ts`), GridFS for binaries (`lib/ote/imports.ts`, `lib/ote/skeleton.ts`, `api/picture`, `api/export`), and a filesystem fallback in `.imports/`. **Verified.**
- **Storage seam.** `lib/server/storage.ts` defines two interfaces: `Data` (get, list, put, remove, plus transactions) and `Storage.bytes`. Mongo and the laptop filesystem are the two implementations. **Verified.** This is the cheapest place to add Supabase.
- **Live sync today.** Server-sent events from `api/projects/[id]/stream`, with `maxDuration = 60`, so each stream is cut after 60 seconds and must reconnect. **Verified.** Supabase Realtime is a fit for this.
- **Knowledge base.** `lib/knowledge/` scans and learns from imported .eote projects (`scan.ts`, `learn.ts`, `conventions.ts`) and stores them in Mongo or in `.knowledge/`. On this laptop `.knowledge/` does not exist, so the local store is empty. **Verified.** Its production size is **to verify** (check the Mongo collection).

## 1. Target architecture

### 1.1 Modules, one deployment

The split is still a set of modules inside one Next.js app on one Vercel project. No separate deployed services (PLAN_SERVICE_SPLIT.md, section "Why not separate services").

| Module | Owns | Used by |
|---|---|---|
| `core/model` | project document types, `lib/refs` cascades | everything |
| `core/ops` | the `Op` union and `applyOps`: the only write path | browser chat, inspector, MCP, collab |
| `generation` | pipeline, draft, brief (section 4) | browser, MCP `generate` |
| `binding` | binder, proposals, adopt | browser import, MCP `import_tags` |
| `io` | .eote reader, packager, tag parsers | import/export routes, MCP |
| `collab` | changes, sync, proposals, presence | browser, MCP proposals |
| `workflows` | start states: `tags`, `screens`, `assumed`, `opened` | start pane, MCP |
| `adapters` | HTTP routes for the web app, MCP route for claude.ai | — |

Adapters hold no rules. If a rule lives in a route handler, it belongs in a module.

### 1.2 Supabase, by role

| Role | Replaces | Notes |
|---|---|---|
| Postgres (via the `Data` interface) | MongoDB collections for projects, revisions, op log, members, proposals | Transactions map to Postgres transactions. Revision numbers stay assigned by the server. |
| Storage bucket | GridFS, `.imports/`, the skeleton blobs, pictures | `Storage.bytes` gets a Supabase implementation. |
| Realtime | the SSE stream | Broadcast carries committed revisions. Presence shows who is in a project. |
| Auth (decision) | NextAuth GitHub/Google | Either keep NextAuth and use Supabase only for data, or move to Supabase Auth. Section 6, decision 2. |

Supabase facts, **verified** on the official pages:

- Realtime has three features: Broadcast (low-latency messages between clients), Presence (who is connected and their state), and Postgres Changes (database change events). Source: [Supabase Realtime guide](https://supabase.com/docs/guides/realtime).
- Storage: the free plan caps the global file size at 50 MB; Pro and above allow up to 500 GB, with bucket limits not above the global one. Source: Supabase file-limits page, found by search.
- Storage uploads: standard uploads go up to 5 GB; resumable (TUS) uploads are recommended above 6 MB, with a 6 MB chunk size. Source: Supabase resumable-uploads page and troubleshooting page.
- Our files: the Schneider templates range from about 19 KB (Blank) to about 3.7 MB (Demo 1); the demo projects are 23–46 KB. **Verified** on disk. So single files fit even the free cap; a customer with many large projects needs Pro.

Not verified, and needed before committing:

- Realtime connection limits, message quotas and pricing. The Realtime page gives no numbers. Check the pricing page.
- Whether a Vercel function should connect to Postgres through the pooler, and which connection string to use. Check the Supabase connect docs.
- Realtime channel authorization for Broadcast (private channels and RLS policies). Check the current syntax when implementing.

### 1.3 The rule that keeps multi-user honest

The server assigns revisions, and the database transaction decides who wins. Realtime only carries what has already been committed. A client that receives a broadcast with a revision gap re-fetches the missing ops. A client never decides a conflict from a broadcast alone. This is the existing `repo.ts` rule, kept as is.

Supabase service-role keys stay on the server only. Browser clients use the anon key, and table access for them goes through row-level security.

## 2. Phases

Each phase is one branch and one reviewable change. The suite stays green at every phase.

| Phase | Work | Done when |
|---|---|---|
| **0. Land current work** | commit the uncommitted fixes and docs on `review/screens-first`, after Shaurya says so; merge Pranav's branch behind it | suite green on the merged branch |
| **1. Finish the split (P2)** | split `store/project.ts` into slices by domain (screens, objects, tags and bindings, alarms and composites, collab). No behaviour change. Move `applyOps` to `core/ops` as the only write path | `store/project.ts` under 400 lines; all tests unchanged |
| **2. Postgres behind `Data`** | a Supabase implementation of `Data` and `Storage.bytes`, chosen by an env flag. Run the existing repo tests against both backends. A one-off migration from Mongo | repo tests pass on both backends; migration dry-run matches counts |
| **3. Bucket for bytes** | `.eote` bytes, skeleton, pictures and uploads move to a Storage bucket. Remove the `.imports/` fallback in production. Large uploads use resumable | an export after a redeploy works; no GridFS left |
| **4. Realtime for live sync** | replace the SSE stream with Broadcast per project; Presence for who is in the project; reconnect and gap re-fetch | two browsers edit one project and see each other within a second; no 60 s cut-off |
| **5. Tags-free generation** | the plant brief (section 4) | section 4's test list passes |
| **6. claude.ai connector** | MCP route on the same deployment, per RESEARCH_CLAUDE_AI_INTEGRATION.md: M1 read tools, M2 writes as proposals, M3 generation as a job, M4 MCP Apps preview, M5 listing | M1 connected from a test account on claude.ai |

Dependencies: phase 1 before 6 (MCP must call `core/ops`, not a copy). Phases 2–4 before 6 for real multi-user use. Phase 5 before the MCP `generate` tool.

## 3. The claude.ai connector

Summary (details in the research doc):

- A remote MCP server over Streamable HTTP, in this app, so it runs on the same Vercel deployment. **Verified** against the official connector flow in the help center; the details are in the research doc.
- Claude connects from Anthropic's cloud, so the route must be public HTTPS. `localhost` works only for development.
- Writes arrive as proposals by default. Editors accept them in the web app, and the sign-off log records each decision.
- The tool list maps onto the `Op` union (`apply_ops`) and the existing pipeline (`generate`), not onto a new API.
- MCP Apps (inline cards) come last. The official design guidelines require host style tokens, both colour modes, and CSP origins declared per resource. **Verified** on the official MCP Apps page.

## 4. Tags-free generation: how it works, where it is weak, and the fix

### 4.1 How it works now (verified in code)

1. The start pane sends the description to `draftTags` (`lib/ai/draft.ts`).
2. `draftTags` asks the model for a tag list (system prompt `DRAFT_SYSTEM`), keeps only legal and unique names, and falls back to rules (`draftByRules`) when the model returns nothing.
3. The rules recognise nine equipment words (pump, motor, conveyor, fan, valve, tank, flow, pressure, temperature), each with a fixed set of signals, and read a count from the sentence ("two pumps").
4. The placeholder tags are recorded as assumed. The ordinary pipeline infers equipment from their names and builds screens.
5. The start pane calls `send(text)` straight after the draft. **There is no review step** between the draft and the build.

### 4.2 Where it is weak

- **Hallucination is possible, and the code allows it.** The model prompt says "List only equipment the description names or clearly implies". "Clearly implies" invites the model to add units the plant does not have.
- **No human checks the draft before the build.** The placeholders appear in the tag panel only after the screens exist.
- **Signal sets are fixed per kind.** Every valve gets OPEN, CLOSED and FLT, whether or not the plant has those signals. The screens then show signals the plant may not have.
- **Silent drops.** Equipment words the rules do not know are ignored, with no message.
- **Vague descriptions fail or drift.** "A plant with some tanks" gives a count of one by default. A description with no known word gives "No equipment was recognised".
- **The knowledge base is not used.** `draftTags` does not read `lib/knowledge/`. The precedent and example-screen tools only run in the chat path, and only when the knowledge store has data. On this laptop it is empty. **Verified.**

Answer to "does the LLM hallucinate, and is there a knowledge base?": yes, it can invent equipment and signals, because nothing checks the draft against the engineer's intent before the build. A knowledge base exists, but it is a store of scanned projects, and nothing feeds it into no-tag drafting yet.

### 4.3 The fix: a plant brief, reviewed before anything is built

A brief is structured data. It is the single input to tags-free generation. The model fills it in; the engineer confirms it.

Brief fields (proposed):

- `plant`: name and a one-line purpose.
- `panel`: the target panel model (already in the project).
- `units`: a list. Each unit has `kind` (from the kind catalogue, section 4.4), `count`, `label` (e.g. "Transfer pump"), and `signals` (a subset of the kind's catalogue, with the engineer able to add or remove).
- `flow`: optional. What feeds what (e.g. "tank 1 feeds pumps 1 and 2"). Used for connections and ordering, not for geometry.
- `alarms`: which signals raise alarms (default: the HI, LO and FLT signals).
- `screens`: which screens to build (default: overview, one per unit group, alarms).
- `naming`: the tag naming convention (default: the ISA-style `<PREFIX>_<NNN>_<SIGNAL>` used today; later, a convention learned from the knowledge base).

Flow (proposed):

1. Engineer types a description, or fills the guided form (the same fields, as inputs).
2. The model proposes a brief from the description. It may only use kinds in the catalogue.
3. Missing details trigger the existing `clarify` mode: the model asks at most two specific questions (for example, "How many tanks?").
4. The brief is shown as a table: units, signals, alarms, screens. The engineer confirms, or edits a row.
5. Only a confirmed brief produces placeholder tags. Each tag records which brief row it came from (provenance).
6. Generation runs on the placeholders. The result is validated: every tag in the project must trace to a confirmed brief row. Any tag that does not is rejected, following the existing "checked, never trusted" pattern.

Strictness rules:

- A brief with no units, or with a count of zero, cannot be confirmed.
- A kind outside the catalogue cannot be added by the model. It can be added by the engineer as a custom unit, with its signals listed explicitly.
- The model never proposes geometry. This is already the product rule (`converse.ts`, "the model never does geometry").

### 4.4 Kind catalogue (to build)

One entry per kind, in code, and it is the source of truth for both the rules and the model:

- kind id, label, tag prefix, the allowed signals with their data types, and the default alarm signals.
- Start with the nine kinds `draftByRules` already has, so behaviour is unchanged for them.
- Later, add entries from the knowledge base: signal sets seen in scanned projects, with counts.

### 4.5 Quality of the screens

The generator already builds from placeholders with the same rules whether the tags are real or assumed. The quality gain comes from the brief: the engineer confirms which units and signals exist, so the screens show only those. The model does not draw.

### 4.6 Tests for section 4

- A brief with a missing count cannot be confirmed; the error names the missing field.
- A draft that includes a unit not in the brief is rejected by validation.
- Every placeholder carries a provenance row, and removing a brief row removes its tags.
- The rules path and the model path produce a brief that validates.
- A description with no catalogue kind returns the clarify question, not a silent empty build.
- The knowledge base, when present, may suggest a signal set but never adds a unit by itself.

## 5. Risks

- **Supabase limits and cost** are unverified (section 1.2). Measure before committing to a plan.
- **Migration risk.** Mongo to Postgres for project revisions must keep revision order and the op log. The migration test compares counts and the last revision of each project.
- **Realtime security.** Broadcast channels must reject a user who is not a member of the project. Test with a non-member account.
- **Prompt injection** through tag names, comments and descriptions (RESEARCH doc). Brief fields are data; the model may not follow instructions inside them.
- **Scope.** Phases 1 to 6 are large. Stop after any phase and ship it; each phase is useful alone.

## 6. Decisions for Shaurya

1. **Phase 0:** commit and push the current work now, on `review/screens-first` and then merged? Nothing is committed yet.
2. **Auth:** keep NextAuth (GitHub/Google) and use Supabase for data only, or move to Supabase Auth? Recommendation: keep NextAuth for phase 2–4, and revisit after phase 6.
3. **Supabase plan:** Free for development, Pro before the first customer with several large projects? Recommendation: Pro before phase 3 ships to a customer.
4. **Brief:** guided form plus free text, or free text only with a confirmation table? Recommendation: both, the form being the primary path.
5. **Knowledge base:** do we want precedent-based naming in drafts? Check the Mongo collection size first.
6. **claude.ai:** which account type tests the connector (Pro or Max for individuals; Team or Enterprise for the Schneider team)?

## 7. Immediate next steps (no code yet)

1. Shaurya answers decisions 1 and 2.
2. Check the Supabase pricing and Realtime limits page, and the Mongo knowledge collection size. Both are unverified in section 1.2 and 4.2.
3. Hand phases 1 and 2 to Antik's Claude, using the prompt in `docs/PROMPT_FOR_ANTIK.md`.
4. Pranav reviews the brief design (section 4.3) before phase 5 starts.
