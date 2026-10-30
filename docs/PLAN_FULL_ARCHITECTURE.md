# Full plan: module split, claude.ai integration, Supabase Realtime, and tags-free generation

Updated 2026-10-29 after decisions from Shaurya. Covers the module split (PLAN_SERVICE_SPLIT.md), the claude.ai connector (RESEARCH_CLAUDE_AI_INTEGRATION.md), live sync on Supabase Realtime, and how screens get built when there are no tags. Each claim is marked **verified** (checked in code, or in a source fetched) or **to verify**.

## 0. Decisions in force

1. **Supabase plan: Free.** Supabase is used for one thing: Realtime live sync. No Supabase Postgres, no Supabase Storage, no Supabase Auth.
2. **Auth: NextAuth only, no OAuth.** No GitHub or Google sign-in. Which NextAuth mechanism remains open; see section 8, decision A. This is work, not a setting: today the app signs in only through GitHub and Google (`web/src/auth.ts`, and `providers()` in `web/src/lib/server/session.ts` enables sign-in only when `AUTH_GITHUB_*` or `AUTH_GOOGLE_*` are set). User ids are `github:<id>` and `google:<id>`, and projects store them as `ownerId` and in `members`. **Verified.**
3. **Data stays in MongoDB.** `.eote` project data, the op log, revisions, members, proposals, and binaries (GridFS) all stay in Mongo. The Postgres migration in the earlier plan is cancelled.
4. **Two databases in the app is allowed only where necessary.** Supabase is necessary only for Realtime. Everything else stays in Mongo.
5. **No user migration.** Production has no users and no project data (Shaurya, 2026-10-29). GitHub and Google sign-in are removed outright; nothing maps old `github:` or `google:` ids.
6. **All remaining phases in one round (2026-10-30).** Shaurya asked for phases 2 to 4 at once, so decisions A (Credentials), B (our own OAuth server for the connector, with a personal access token fallback) and D (form plus free text) take the recommendations in section 8. Shaurya sets up Supabase himself through the Supabase MCP; the code ships the SQL migration, the env list and a `realtime:check` script for it.

Phases 2 (Postgres behind `Data`) and 3 (Storage bucket) of the earlier plan are cancelled by decision 3. The earlier phase 4 becomes "Realtime only", now phase 2, and it starts with the sign-in change that decision 2 needs.

## 1. Where things stand

- **main** is at `cfbe5a1` or later (this plan's decisions landed there). Every feature branch is merged into it. Suite: 1184 passing, 17 skipped; typecheck clean. **Verified** on the last run.
- **Storage today.** MongoDB for metadata, the op log, membership and revisions (`web/src/lib/server/repo.ts`, `storage.ts`). GridFS for binaries (`lib/ote/imports.ts`, `lib/ote/skeleton.ts`, `api/picture`, `api/export`). A filesystem fallback in `.imports/` for the laptop. **Verified.**
- **Storage seam.** `lib/server/storage.ts` has two interfaces: `Data` and `Storage.bytes`. Mongo and the laptop filesystem are the two implementations. **Verified.**
- **Live sync today.** Server-sent events from `api/projects/[id]/stream` with `maxDuration = 60`, so every stream is cut after 60 seconds and must reconnect. **Verified.** This is the one thing Supabase Realtime replaces.
- **Knowledge base.** `lib/knowledge/` learns from imported `.eote` projects and stores them in Mongo, or in `.knowledge/` on the laptop. The laptop's `.knowledge/` folder does not exist, so the local store is empty. **Verified.** Production size is **to verify** (Mongo collection count).

## 2. Target architecture

### 2.1 Modules, one deployment

The split stays inside one Next.js app on one Vercel project. No separate deployed services.

| Module | Owns | Used by |
|---|---|---|
| `core/model` | project document types, `lib/refs` cascades | everything |
| `core/ops` | the `Op` union and `applyOps`: the only write path | browser chat, inspector, MCP, collab |
| `generation` | pipeline, draft, plant brief (section 4) | browser, MCP `generate` |
| `binding` | binder, proposals, adopt | browser import, MCP `import_tags` |
| `io` | `.eote` reader, packager, tag parsers | import/export routes, MCP |
| `collab` | changes, sync, proposals, presence | browser, MCP proposals |
| `workflows` | start states: `tags`, `screens`, `assumed`, `opened` | start pane, MCP |
| `adapters` | HTTP routes for the web app, the MCP route for claude.ai | — |

### 2.2 Who stores what

| Concern | Where | Why |
|---|---|---|
| Projects, `.eote` data, op log, revisions, members, proposals | MongoDB (existing `Data` implementation) | Decision 3. Already built and tested. |
| Binaries: skeleton, pictures, uploads, `.eote` bytes | MongoDB GridFS (existing) | Decision 3. |
| Live sync (who is in a project, committed revisions) | Supabase Realtime: Broadcast and Presence | The only reason for a second service: SSE is cut at 60 s on Vercel. |
| Login | NextAuth (see section 6, decision A) | Decision 2. |

### 2.3 The Realtime rules

- Broadcast carries a **small notification**, not the ops: the project id, the new revision number, and the author. Supabase's Free plan caps one message at **256 KB** (verified), and a large op batch would exceed it. Clients fetch the ops for the revision from the existing API.
- The server assigns revisions, and the Mongo transaction decides who wins. A broadcast is only a hint that something committed. A client never resolves a conflict from a broadcast alone.
- A client that sees a revision gap re-fetches from the API.
- Non-members must not receive a project's broadcasts. Use Supabase private channels, and check the authorization syntax in the Realtime docs when implementing. Test with a non-member account.
- The Supabase service-role key stays on the server. Browsers receive a short-lived token minted by the server for the one project the user can read.

## 3. Supabase facts

Verified on Supabase's pricing page (no date shown on the page):

- **Free plan:** 200 peak Realtime connections, 2 million Realtime messages per month, 256 KB maximum message size, 500 MB database, 1 GB file storage, 5 GB egress, 50 MB file upload limit, 2 active projects.
- **Pro:** 500 peak connections and 5 million messages; overage $10 per 1,000 peak connections and $2.50 per million messages.
- **Pausing (important):** Free projects pause after **1 week of inactivity**. A paused project refuses Realtime connections.

Consequences for us:

- 200 concurrent connections is enough for a small team, and the message quota is large for notifications of revisions.
- **Pause risk.** Whether Realtime traffic counts as "activity" is **to verify**. Until it is verified, add a keep-alive: a Vercel Cron job (AGENTS.md: Cron Jobs run in UTC and call the production URL over HTTP GET) that calls a Supabase endpoint every few days. Also set an alert on the health check.
- Realtime is the only Supabase feature we depend on. If the free project pauses and cannot be kept alive, the fallback is to keep SSE with a reconnect loop, and that is the only change needed.

**Not verified:** the Realtime per-second message rate, and whether Vercel functions should use the Supabase pooler for anything (not needed now, since we use no Supabase database).

## 4. The claude.ai connector

Summary (details in RESEARCH_CLAUDE_AI_INTEGRATION.md):

- A remote MCP server over Streamable HTTP, served from this app on the same Vercel deployment. **Verified** against the help-center connector flow.
- Claude connects from Anthropic's cloud, so the route must be public HTTPS.
- The connector authenticates with the same NextAuth session as the web app, through the connector's OAuth flow. Because decision 2 rules out OAuth *providers* (GitHub, Google), this needs a decision: see section 6, decision B. This is the one part of the connector plan that depends on the auth decision.
- Writes arrive as proposals by default. Editors accept them in the web app, and the sign-off log records each decision.
- The tools map onto the `Op` union (`apply_ops`) and the existing pipeline (`generate`).
- MCP Apps (inline cards) come last. They need host style tokens, both colour modes, and CSP origins declared per resource. **Verified** on the official MCP Apps page.

## 5. Tags-free generation: how it works, where it is weak, and the fix

### 5.1 How it works now (verified in code)

1. The start pane sends the description to `draftTags` (`lib/ai/draft.ts`).
2. `draftTags` asks the model for a tag list (system prompt `DRAFT_SYSTEM`), keeps only legal and unique names, and falls back to rules (`draftByRules`) when the model returns nothing.
3. The rules recognise nine equipment words (pump, motor, conveyor, fan, valve, tank, flow, pressure, temperature), each with a fixed signal set, and read a count from the sentence ("two pumps").
4. The placeholder tags are recorded as assumed. The ordinary pipeline infers equipment from their names and builds screens.
5. The start pane calls `send(text)` straight after the draft. **There is no review step** between draft and build.

### 5.2 Where it is weak

- **Hallucination is possible, and the code allows it.** The prompt says "List only equipment the description names or clearly implies". "Clearly implies" invites the model to add units the plant does not have.
- **No human checks the draft before the build.** The placeholders appear in the tag panel only after the screens exist.
- **Signal sets are fixed per kind.** Every valve gets OPEN, CLOSED and FLT, whether or not the plant has them.
- **Silent drops.** Equipment words the rules do not know are ignored, with no message.
- **Vague descriptions drift.** "A plant with some tanks" gives a count of one by default.
- **The knowledge base is not used.** `draftTags` does not read `lib/knowledge/`. On the laptop the store is empty. **Verified.**

Answer to "does the LLM hallucinate, and is there a knowledge base?": yes, it can invent equipment and signals, because nothing checks the draft against the engineer's intent before the build. A knowledge base exists, but nothing feeds it into no-tag drafting yet.

### 5.3 The fix: a plant brief, reviewed before anything is built

A brief is structured data and the single input to tags-free generation. The model fills it in; the engineer confirms it.

Brief fields:

- `plant`: name and a one-line purpose.
- `panel`: the target panel model (already in the project).
- `units`: a list. Each unit has `kind` (from the catalogue, 5.4), `count`, `label`, and `signals` (a subset of the kind's catalogue; the engineer can add or remove).
- `flow`: optional. What feeds what. Used for connections and ordering, not geometry.
- `alarms`: which signals raise alarms (default: HI, LO and FLT).
- `screens`: which screens to build (default: overview, one per unit group, alarms).
- `naming`: the tag naming convention (default: the `<PREFIX>_<NNN>_<SIGNAL>` pattern used today).

Flow:

1. The engineer types a description, or fills the guided form (the same fields as inputs).
2. The model proposes a brief from the description, using only catalogue kinds.
3. Missing details trigger the existing `clarify` mode: at most two specific questions.
4. The brief is shown as a table: units, signals, alarms, screens. The engineer confirms or edits a row.
5. Only a confirmed brief produces placeholder tags. Each tag records its brief row (provenance).
6. Generation runs on the placeholders. Validation then checks that every tag traces to a confirmed row. Any tag that does not is rejected, following the existing "checked, never trusted" pattern.

Strictness:

- A brief with no units, or a count of zero, cannot be confirmed.
- The model cannot add a kind outside the catalogue. The engineer can add a custom unit, with its signals listed explicitly.
- The model never proposes geometry (product rule, `converse.ts`).

### 5.4 Kind catalogue (to build)

One entry per kind, in code, the source of truth for both rules and model: kind id, label, tag prefix, allowed signals with data types, default alarm signals. Start with the nine kinds `draftByRules` already has, so behaviour is unchanged for them. Later, add signal sets seen in the knowledge base, with counts.

### 5.5 Quality of the screens

The generator already builds from placeholders with the same rules whether tags are real or assumed. The gain comes from the brief: the engineer confirms which units and signals exist, so the screens show only those. The model does not draw.

### 5.6 Tests

- A brief with a missing count cannot be confirmed; the error names the missing field.
- A draft that includes a unit not in the brief is rejected by validation.
- Every placeholder carries a provenance row; removing a brief row removes its tags.
- The rules path and the model path both produce a brief that validates.
- A description with no catalogue kind returns the clarify question, not a silent empty build.
- The knowledge base, when present, may suggest a signal set but never adds a unit by itself.

## 6. Phases

Each phase is one branch and one reviewable change. The suite stays green at every phase.

| Phase | Work | Done when | Blocked on |
|---|---|---|---|
| **1. Finish the split** | slice `store/project.ts` by domain (screens, objects, tags and bindings, alarms and composites, collab); move the write path to `core/ops`. No behaviour change. | `project.ts` under 400 lines; all tests unchanged | — |
| **2. Sign-in without OAuth, then Realtime** | First: replace the GitHub and Google providers with the mechanism from decision A (`auth.ts`, `session.ts` `providers()`/`cloudEnabled()`, the account UI, a password hash on the user record if Credentials), keeping the laptop's local identity and the fail-closed deployment rule. Then: Supabase Realtime Broadcast per project (revision notifications, section 2.3) and Presence; reconnect and gap re-fetch; server-minted tokens; keep-alive cron | a user signs in with no OAuth env set; two browsers see each other's revisions within a second; a non-member receives nothing; no 60 s cut-off | decision A (auth mechanism) |
| **3. Tags-free generation** | the plant brief (section 5) | section 5.6 tests pass | Pranav reviews the brief design |
| **4. claude.ai connector** | `/api/mcp` on this deployment, per RESEARCH_CLAUDE_AI_INTEGRATION.md: M1 read tools; M2 writes as proposals; M3 generation as a job; M4 MCP Apps preview | M1 connected from a test account on claude.ai | decision B (connector auth), decision C (account type) |

Phase 1 first. Phases 2 and 3 can run in either order after it. Phase 4 needs phase 1 (MCP calls `core/ops`, not a copy), and its generate tool needs phase 3.

Cancelled by decision 3: the Postgres implementation of `Data`, the migration from Mongo, and the Supabase Storage bucket.

## 7. Risks

- **Free project pause** after one week of inactivity (section 3). Mitigation: keep-alive cron, verified before relying on it.
- **Realtime security.** Non-members must not receive broadcasts. Test it.
- **Broadcast size.** Messages are capped at 256 KB, so broadcasts carry notifications only (section 2.3).
- **Prompt injection** through tag names, comments and descriptions. Brief fields are data; the model may not follow instructions inside them.
- **Auth scope.** NextAuth without OAuth still needs a credential method, and the connector's login depends on it (section 4).
- **Two databases.** Mongo and Supabase in one app. Keep Supabase to Realtime only, so the second dependency stays small.

## 8. Decisions

**Resolved**
1. Supabase plan: Free.
2. Auth: NextAuth only, no OAuth.
3. Data in MongoDB, including `.eote` bytes in GridFS.
4. No user migration: production has no users or data, so OAuth is removed without mapping old accounts.

**Still open**

- **A. NextAuth mechanism without OAuth.** Options:
  - **Credentials provider (email and password, passwords hashed).** Needs no third-party service. Recommended.
  - Email magic link. Needs an email sending service, which is a new vendor.
  Recommended, but no sign-in code is written until Shaurya confirms.
- **B. Connector login.** claude.ai's custom connector authenticates through an OAuth flow that our server exposes. That is a server-side OAuth authorization server, which is not an OAuth *provider* login. Options: (1) our server issues its own connector tokens after the NextAuth login, or (2) a personal access token pasted into the connector's header setting. Recommendation: (1) for the team, with (2) as a fallback if claude.ai's flow cannot be made to work.
- **C. claude.ai account type** for testing: Pro or Max for individuals; Team or Enterprise for the Schneider team.
- **D. Brief design:** guided form plus free text (recommended), or free text only.
- **E. Knowledge base in drafting:** check the Mongo collection count first.
## 9. Immediate next steps

1. Shaurya confirms A (credentials, or magic link) and C.
2. Verify the Free-plan pause behaviour for Realtime traffic: whether a Realtime connection counts as activity. Until verified, the keep-alive cron is required.
3. Antik's Claude starts phase 1 now (no decision needed).
4. Pranav reviews the brief design (section 5.3) before phase 3.
