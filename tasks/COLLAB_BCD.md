# Collaboration phases B, C and D - handoff

Owner: Antik (with Claude Code). Reviewer: Shaurya's Claude, who will pull `collab`, read every diff, and run the checks below plus the .eote harnesses before anything reaches `main`.

## Setup on a fresh machine
```
git fetch origin && git checkout collab && git pull
cd web && npm ci
```
The project skeleton (`web/skeleton/`) and `src/lib/ote/graphics-index.json` are Schneider's files and are not in the repository; tests that need them skip themselves, and nothing in this task needs them. No `.env.local` is needed: with no auth provider configured the app runs in local mode as one implicit user, and with no `MONGODB_URI` the repo uses the filesystem store under `web/.data/`.

---

Work in the `web/` folder of this repository (Next.js 15, React 19, TypeScript, zustand, Tailwind 4, vitest), deployed on Vercel. Branch `collab`. Phase A (accounts, server projects, members/roles, permanent sources, versions, chunked upload) and its review fixes are already on the branch: read docs/COLLAB_PHASE_A.md first.

# Goal: Phases B, C and D of collaboration, in ONE run

Read first, in this order: docs/COLLAB_PHASE_A.md; src/lib/server/{repo,session,access}.ts and the /api/projects, /api/upload routes; src/store/project.ts, src/store/persist.ts, src/store/types.ts; src/lib/ai/ops.ts (the Op language) and src/lib/ai/applier.ts (applyOps, dryRun, commit); src/lib/ai/{converse.ts,review.ts}; src/components/chat/{ChatPanel.tsx,useChat.ts}; src/components/canvas/ScreenRenderer.tsx (how carried-object placeholders and proposal ghosts are drawn outside object groups); src/lib/agent/{loop.ts,build.ts}; src/lib/program/regenerate.ts; src/lib/validation/report.ts; src/lib/ote/reader.ts (`alarmKey`); src/fixtures (demo data for tests); Vercel facts: functions are stateless and cannot hold WebSockets; use `waitUntil` for post-response work; secrets live in env vars.

This task has three parts, specified in full below. B, C and D build on each other (C needs B's access rules; D needs C's change log), so:
- Do B, then C, then D, OR use parallel sub-agents where the work is independent (for example: B's share/comment UI, C's pure `changes.ts` and its tests, D's proposal repo and lock) and integrate in order. You decide the split; the result must be one coherent tree.
- Run the checks (tsc, vitest, next build) after EACH part, not only at the end, so a break is found where it was made.
- Shared rules for all three parts: commit after each part on `collab` and push it (never merge into or push `main`); never add a `Co-Authored-By: Claude` trailer or a "Generated with Claude Code" line to any commit or PR - the repository owner's rule; no new vendors (no Liveblocks, Supabase, Postgres, Pusher, Ably, Vercel Blob); no changes to src/lib/ote/** or the .eote format; do not weaken or delete existing tests;  never print or write secrets.

Final summary: write it to `tasks/COLLAB_BCD.report.md` and commit it with the last part. It must cover all three parts: files, routes, the vitest totals line after each part and at the end, the build result, and anything unsure or left out.


==================================================================
# PART B
==================================================================
# Goal: Phase B - share links and comments

## Decisions already made
1. **Share links**: an owner or "manage" role creates a link for a project with a role (`viewer` | `commenter` | `editor`), an optional expiry (default 14 days, max 90), and an optional "allow export" flag (default off for viewer). Store in the repo as `shares`: {_id (random 32-byte url-safe token, store only its SHA-256 hash), projectId, role, createdBy, createdAt, expiresAt, allowExport, revokedAt?}. Add the collection to all three Repo implementations (Mongo, File, Memory).
2. **Opening a link** `/s/<token>`: if valid, a signed-in user is added to `members` with that role (never downgrading an existing higher role) and redirected to `/project/<id>`; a signed-out visitor with a viewer link gets a read-only view of the project at `/s/<token>` without an account (the token is the capability); commenter/editor links require sign-in. Expired or revoked → a clear page saying so.
3. **Access helper**: extend `can()` in src/lib/server/access.ts so a share token in the request (cookie `hmi_share`, set when /s/<token> is opened signed-out) grants its role for that one project only. Read-only means: the canvas renders, selection and inspector work read-only, every editing affordance is hidden or disabled (toolbar tools, Insert menu, chat input, delete/move/resize, generate, regenerate). Find these via the existing components; add one `useCanEdit()` hook and use it rather than scattering checks.
4. **Comments**: pinned to a project and optionally to a screen and an object (`UniqueId`), with a position on the canvas. Store `comments`: {_id, projectId, screenId?, objectId?, x?, y?, authorId, body (plain text, ≤ 4000 chars), createdAt, resolvedAt?, resolvedBy?, parentId? (one level of replies)}. Routes `/api/projects/[id]/comments` (GET list, POST create) and `/api/projects/[id]/comments/[cid]` (PATCH resolve/unresolve/edit own body, DELETE own or manage). Commenter role and up can comment; viewer can read.
5. **UI**: a "Share" button in the project header opening a dialog: current members with roles (owner can change/remove), existing links (copy, revoke), create link. A comments mode on the canvas: numbered pins drawn above objects (outside the object group, not hit-testable as objects, like the existing carried-object placeholders in src/components/canvas/ScreenRenderer.tsx), a side list per screen, reply/resolve. Use existing UI primitives in src/components/ui.
6. **Sign-off tie-in**: the validation report (src/lib/validation/report.ts) lists unresolved comments count per screen.

## Deliver
Repo additions, routes, the /s/[token] page, access changes, useCanEdit, Share dialog, comments UI, and tests: `tests/shares.test.ts` (token hashing, expiry, revoke, role never downgraded, signed-out viewer only), `tests/comments.test.ts` (permissions matrix, replies one level, resolve), plus an SSR render test that a read-only project hides the edit affordances. Update docs/COLLAB_PHASE_A.md → add a "Phase B" section.

## Don't
No new vendors; no changes to src/lib/ote/** or the .eote format; do not weaken existing tests;  never print secrets.

## Checks before finishing
`npx tsc --noEmit`, `npx vitest run`, `NEXT_DIST_DIR=.next-build npx next build` then `git checkout -- next-env.d.ts tsconfig.json`.

## Finish
Concise summary: files, routes, test totals line, build result, anything unsure or left out.

==================================================================
# PART C
==================================================================
# Goal: Phase C - two or more people editing the same project live

## Why this design (decided; do not swap it for a vendor)
Vercel functions are stateless and cannot hold WebSockets, and we will not add a realtime vendor now. So: a **server-authoritative operation log** over plain HTTP, with Server-Sent Events for push. The app already describes every edit as data (the `Op` language the chat and agent use, applied by `applyOps`); manual canvas edits go through store actions. Latency target ≈ 1 s, which is fine for engineering work.

## Decisions
1. **Edit unit = a "change"**: `{ id (uuid from the client), base: rev, author, ops: StoreChange[] }` where `StoreChange` is a small, serialisable, idempotent description of one store mutation at the granularity of one part or one record: `setPart {screenId, part}` (whole part JSON after the edit), `removePart {screenId, partId}`, `addScreen/removeScreen/renameScreen/reorderScreens`, `setVariable/removeVariable`, `setAlarm/removeAlarm` (by stable key: see `alarmKey` in src/lib/ote/reader.ts), `setBinding/removeBinding` (by targetId+property). Derive changes in the client by diffing the store before/after each committed action (a zustand subscribe on the project slices); do NOT rewrite every store action. Put the diff and apply functions in `src/lib/collab/changes.ts`, pure and unit-tested.
2. **Server**: `POST /api/projects/[id]/changes` {base, changes[]}: under the project's rev, apply in order to the latest snapshot (pure apply from changes.ts), increment rev per accepted change, append to a `changes` log collection {projectId, rev, change, author, at} (keep 2,000 per project; older are compacted into the snapshot), and answer {rev, accepted ids, rejected [{id, reason}]}. **Conflict rule: last writer wins per part/record** (a whole-part `setPart` replaces), except `removePart` beats a concurrent `setPart` on the same part only if it is newer by rev. Use a per-project lock: Mongo `findOneAndUpdate` on `rev` (compare-and-set loop), File repo a process lock.
3. **Push**: `GET /api/projects/[id]/stream?since=rev` - SSE, sends `change` events from the log after `since`, plus `presence` events; keep each connection ≤ 55 s (`export const maxDuration = 60`), the client reconnects with the last rev. If `since` is older than the retained log, send `reset` with the snapshot.
4. **Client sync** `src/lib/collab/sync.ts`: queue local changes, POST in batches every 300 ms, apply remote changes to the store without re-emitting them, rebase pending local changes on top (re-apply after remote), show a small "n people here" avatar row. Undo stays per user: the existing undo stack only reverts the user's own changes (implement by turning the user's own change into its inverse StoreChange and sending that).
5. **Presence**: `POST /api/projects/[id]/presence` heartbeat every 5 s {screenId, selection: partIds[], cursor?: {x,y}} → stored with a 15 s TTL; broadcast over the stream. Canvas shows other users' selections as coloured outlines with their name, and their cursors on the same screen. A part selected by someone else shows "Asha is editing" and is still editable (soft lock).
6. **Export uses a snapshot**: the export route packages the server snapshot at a given rev (the client sends rev), never a half-synced local state.
7. Only when cloud is enabled and the project is a cloud project; local/browser-only projects are unchanged.

## Deliver
`src/lib/collab/{changes,sync,presence}.ts`, the three routes, store wiring (subscribe-diff, remote apply flag), canvas presence overlay (outside object groups, not hit-testable), header avatars. Tests: `tests/collab-changes.test.ts` (diff/apply round trip on the demo fixtures in src/fixtures; idempotent re-apply; inverse for undo), `tests/collab-server.test.ts` (two clients against MemoryRepo: concurrent edits to different parts both land; same part → last writer wins; stale base rebased; log compaction; reset when too old), `tests/collab-sync.test.ts` (client queue, rebase, no echo). Add a "Phase C" section to docs/COLLAB_PHASE_A.md including the latency and the conflict rule.

## Don't
No WebSocket servers, no new vendors, no changes to src/lib/ote/** or the .eote format, do not weaken tests, never print secrets.

## Checks before finishing
`npx tsc --noEmit`, `npx vitest run`, `NEXT_DIST_DIR=.next-build npx next build` then `git checkout -- next-env.d.ts tsconfig.json`.

## Finish
Concise summary: files, routes, test totals line, build result, anything unsure or left out.

==================================================================
# PART D
==================================================================
# Goal: Phase D - the AI agent as a collaborator in a shared project

## Decisions
1. **The agent is a member** with author id `agent:<provider>:<model>` and display name "HMI Copilot". Every change it makes carries that author in the change log (Phase C) and its ObjectMeta provenance stays "generated".
2. **Proposals are shared**: when any user asks the chat for an edit in a cloud project, the agent's result is never committed straight to the shared document. It becomes a `proposal` record {_id, projectId, screenId, requestedBy, request text, ops, changes (StoreChange[] from a dry run), createdAt, status: open|accepted|partially-accepted|discarded, decidedBy?, decidedAt?, acceptedOpIndexes?}. Proposals are broadcast on the project stream; every member sees the ghosts on the canvas (reuse the existing proposal/ghost rendering) and the list in the chat panel.
3. **Who may decide**: editors and owners accept or discard, per op (the per-op ticking UI exists); commenters can comment on a proposal; viewers see it. Accepting sends only the ticked ops' changes through the normal Phase C change path, authored by the agent, with `acceptedBy` recorded.
4. **One agent turn per screen at a time**: a server lock {projectId, screenId, holder, expiresAt (90 s)}; a second request on the same screen waits or is told "Copilot is working on this screen for Ravi".
5. **Audit / sign-off**: a `decisions` log of every proposal decision; the validation/sign-off report (src/lib/validation/report.ts) gains a table "AI-suggested changes and who accepted them".
6. **Server-side agent run for shared projects**: add `POST /api/projects/[id]/agent` that runs `runAgent` (src/lib/agent/loop.ts) against the server snapshot for "build/check/repair" requests and returns a proposal instead of bytes; stream its steps to the requester over the existing stream as `agent` events. No bench on the server.
7. Browser-only projects keep today's behaviour.

## Deliver
Repo additions (proposals, decisions, agent locks), routes, chat panel wiring for shared projects, canvas ghosts from shared proposals, report section, and tests: `tests/proposals.test.ts` (create via dry run, accept subset → only those changes land, authored by agent, decision logged; discard; permission matrix), `tests/agent-lock.test.ts` (one turn per screen, expiry), and an integration test that two simulated clients both receive the proposal and see the accepted changes. Add a "Phase D" section to docs/COLLAB_PHASE_A.md.

## Don't
No new vendors, no changes to src/lib/ote/** or the .eote format, do not weaken tests, never print secrets. Do not call a real model in tests (AI_PROVIDER=none or a stubbed converse).

## Checks before finishing
`npx tsc --noEmit`, `npx vitest run`, `NEXT_DIST_DIR=.next-build npx next build` then `git checkout -- next-env.d.ts tsconfig.json`.

## Finish
Concise summary: files, routes, test totals line, build result, anything unsure or left out.
