# Collaboration phases B, C and D - report

Branch `collab`, three commits on top of `939eca1` (one per part, the last carrying this report). Nothing merged into or pushed to `main`. No commit carries a Co-Authored-By or "Generated with" line. Nothing under `web/src/lib/ote/**` changed, and the .eote format is untouched. `web/skeleton/` and `graphics-index.json` are not in git.

Design summary is in `docs/COLLAB_PHASE_A.md`, sections "Phase B", "Phase C" and "Phase D".

## Checks

All three checks were run inside `web/` after each part:

- `npx tsc --noEmit`: clean after each part.
- `npx vitest run`: totals below.
- `NEXT_DIST_DIR=.next-build npx next build`, then `git checkout -- next-env.d.ts tsconfig.json`: succeeded after each part.

| After | Vitest totals |
| --- | --- |
| Baseline (`939eca1`) | 72 files, 941 passed, 21 skipped |
| Part B (`fd23ab7`) | 75 files, 970 passed, 21 skipped |
| Part C (`3408cc9`) | 79 files, 1046 passed, 21 skipped |
| Part D (final) | **82 files passed, 1060 passed, 21 skipped (1081)** |

The test machine has a local `web/skeleton/`. The 21 skips are the ones already in the suite, and none of the new tests needs the skeleton. No existing test was changed, skipped or deleted. No test calls a model: the D tests stub `AI_PROVIDER=none`.

How each part's checks were isolated: B and C were developed partly in parallel with the next part. Before each commit, the later part's files were moved out of the tree and its hunks removed from shared files. The checks above then ran on exactly the committed tree, and the later work was put back afterwards.

## Part B: share links and comments

**Server**
- `src/lib/server/repo-collab.ts` (new): `shares` and `comments` collections, the `putMember` helper and `shareState`.
- `src/lib/server/repo.ts`: wires these in.
  - `members.list` and `members.remove` added.
  - `members.put` keeps the original `addedAt` and can set `exportDenied`.
  - Deleting a project now removes all of its collaboration rows.
- `src/lib/server/storage.ts`: the File store's table list gains all B/C/D tables, Mongo gains indexes, `validId` moved here, and memory queries understand `{ $gt }`.
- `src/lib/server/shares.ts` (new): token creation and SHA-256 hashing, the `hmi_share` cookie, `inspectShare`, `joinShare`, `cookieShares`.
- `src/lib/server/access.ts`:
  - New `accessOf()`: membership plus viewer cookie shares.
  - `can()`, `requireAccess()` and `sourceInfo()` take the request's tokens.
  - New `requireReader()` for routes a signed-out viewer may use.
- `src/lib/server/comments.ts` (new): the permission matrix and per-screen unresolved counts.
- `src/lib/server/signoff.ts` (new): the shared-project sections of the report.
- `src/lib/validation/report.ts`: an unresolved-comments-per-screen table.

**Routes**
- `GET|POST /api/projects/[id]/shares`
- `DELETE /api/projects/[id]/shares/[shareId]`
- `POST /api/shares/open`
- `GET /api/projects/[id]/members`
- `PATCH|DELETE /api/projects/[id]/members/[userId]`
- `GET|POST /api/projects/[id]/comments`
- `PATCH|DELETE /api/projects/[id]/comments/[cid]`
- Page `/s/[token]`.
- `GET /api/projects/[id]` now also returns `access`. The picture route and the report route accept the share cookie or project id.

**Client** (built by a sub-agent, reviewed and integrated here)
- `src/store/access.ts` with `useCanEdit()`, applied in:
  - the canvas: CanvasPane, CanvasToolbar, InsertMenu, ScreenStrip, ScreenBoard/ScreenRenderer (`readOnly`), the context menu, shortcuts, RegenerateDialog;
  - the inspector and layers panel;
  - the library, the chat panel, TopBar, Workspace (start pane) and TagImport.
- New files:
  - `ShareDialog.tsx`;
  - `SharedProjectView.tsx`;
  - `components/comments/{useComments.ts,CommentsPanel.tsx}`.
- Comment pins in ScreenRenderer are drawn outside the object groups.

**Tests:** `tests/shares.test.ts`, `tests/comments.test.ts`, `tests/readonly.test.ts` (SSR render of read-only versus local).

## Part C: live co-editing

**Library**
- `src/lib/collab/types.ts`: the Change and StoreChange vocabulary.
- `src/lib/collab/changes.ts`: diff, apply, invert, compact and validate. Pure; written by a sub-agent and reviewed.
- `src/lib/collab/sync.ts`: CollabSession. It queues, batches every 300 ms, rebases, suppresses echoes, does per-user undo by inverse, and sends presence heartbeats.
- `src/lib/collab/browser.ts`: the fetch/EventSource transport.
- `src/lib/collab/package.ts`: one `packageInputOf` shared by the client export and the server export.

**Server**
- `src/lib/server/repo-live.ts`: the change log, heads, the at-rev rebuild, presence, and history checkpoints.
- `src/lib/server/stream.ts`: the SSE event generator.

**Client wiring**
- `src/components/shell/useCollab.ts`, `src/store/presence.ts`.
- Changes in `persist.ts` (snapshot PUT stands down while live), `Workspace.tsx`, `SharedProjectView.tsx`, `CanvasPane.tsx`, `ScreenRenderer.tsx`, `ScreenBoard.tsx`, `TopBar.tsx` and `useExport.ts`.
- `src/components/collab/{PresenceOverlay,PresenceAvatars}.tsx` and `tests/presence-ui.test.ts` were written by the Antigravity CLI (`/agy`, gemini-3.8-flash-high). Its 8 tests were checked here; two Tailwind class names were adjusted.

**Routes**
- `POST /api/projects/[id]/changes`
- `GET /api/projects/[id]/stream?since=rev` (`maxDuration = 60`)
- `POST /api/projects/[id]/presence`
- `/api/export` accepts `{ projectId, rev }`.

**Tests:** `tests/collab-changes.test.ts` (51), `tests/collab-server.test.ts` (11), `tests/collab-sync.test.ts` (6), `tests/presence-ui.test.ts` (8).

## Part D: the agent as a collaborator

**Library and server**
- `src/lib/collab/proposal.ts`: dry run on a snapshot, agent-run changes, previews from changes, and `generated` provenance.
- `src/lib/server/repo-agent.ts`: proposals, decisions, agentLocks.
- `src/lib/server/proposals.ts`: the agent's author id, lock and unlock, propose, decide, and the stream feed.
- `src/lib/server/agent-run.ts`: the server-side `runAgent` run.
- `src/lib/agent/loop.ts`: new `from` (start from a snapshot) and `prove: false` options, plus `input` on the `done` step. The defaults keep the CLI's behaviour.
- `report.ts` and `signoff.ts`: the "AI-suggested changes and who accepted them" table.
- `repo-collab.ts` and `comments.ts`: a comment can carry `proposalId`.

**Client**
- `src/store/proposals.ts`, `src/components/chat/{shared.ts,SharedProposals.tsx}`.
- Changes in `useChat.ts` (the shared path), `ChatPanel.tsx`, `useCollab.ts` and the stream route.

**Routes**
- `GET|POST /api/projects/[id]/proposals`
- `POST /api/projects/[id]/proposals/[pid]`
- `POST|DELETE /api/projects/[id]/agent/lock`
- `POST /api/projects/[id]/agent`

**Tests:** `tests/proposals.test.ts` (7), `tests/agent-lock.test.ts` (6), `tests/collab-agent.test.ts` (1; two simulated browsers).

## Decisions made here (not in the brief)

1. **Copying links.** Only the token's hash is stored, so the server cannot return a link later. The token is shown once at creation and cached in the creating browser's localStorage, so Copy works there; other browsers show "created on another device".
2. **Default export flag.** `allowExport` defaults to off for viewer links and on for commenter and editor links.
3. **Joining a viewer link that withholds export.** The membership is marked `exportDenied`. Joining again through a link that allows export lifts it.
4. **Signed-out cookie.** It holds up to 8 tokens, so a visitor can hold links to several projects. It only ever grants viewer access.
5. **Edits outside the brief's StoreChange list.** Things that are not parts or records travel as `setScreenProps`, `reorderParts`, `setEntry`/`removeEntry` (objectMeta, screenPlacement, handles, composites, programs, foreign) and `setField` (name, target, standards, plant, tagImport, source, sourceId, layout, handleSeq).
6. **What is not synced.** The conversation, the in-app version list and the active screen stay per browser. A pure reordering of variables, alarms or bindings is not synced.
7. **Live head and history.** The live snapshot is a `heads` row. `versions.current()` returns the newer of the head and the last version, so Phase A readers see live edits. A "Live edits" version is written at most every 10 minutes, within the existing 50-version cap.
8. **The per-project lock is the storage transaction.** Mongo retries conflicting transactions on the project document, which acts as a compare-and-set on its rev; the File store uses its exclusive lock. No separate `findOneAndUpdate` loop was written.
9. **A rejected change.** The client reloads the server snapshot and keeps its unsent queue, rather than trying to repair the change locally.
10. **Undo during a session.** Undo/redo are replaced by inverse-sending versions. The store's `past` stack still grows, so the Undo button can look enabled when nothing of yours is left to undo; pressing it is then a no-op.
11. **Exporting with unconfirmed changes.** A shared project refuses to export while this tab has unconfirmed changes ("still being saved"), instead of exporting an older rev without saying so.
12. **Accepting a proposal.**
    - Chat proposals re-run the ticked ops on the latest snapshot.
    - Agent runs (build/repair) have one fixed group of changes, accepted or discarded whole. Their repair ops reference handles of a scratch store, so they cannot be re-run individually.
13. **A shared-project build.** "Build" or "extend" from the chat runs `runAgent` in build mode on the server, which proposes a fresh build of the whole application. On a project with content, the proposal therefore shows removals; there is no server-side extend.
14. **The agent route.** It answers 202 and runs after the response with Next's `after`; no new dependency. Its steps travel on the lock row.
15. **Second turn on a busy screen.** It is told who has the screen (409) rather than waiting.
16. **Commenting on proposals.** Commenters do it through ordinary project comments carrying `proposalId`.

## Left out, or unsure

- **Not exercised here:** real MongoDB transactions, OAuth sign-in through `/s/<token>`, EventSource against a deployed Vercel function, and `after()` on Vercel. Everything server-side was tested against MemoryRepo, the route handlers were called directly, and the session was tested with an in-memory transport.
- **No .eote harnesses or browser run.** I did not run the .eote harnesses or click through the app in a browser. Of the UI, only the read-only rendering and the presence components have render tests.
- **Reloading with unconfirmed live changes.** These are held in memory. A reload with changes still queued marks the device cache dirty, and the Phase A "Changed elsewhere" prompt then appears instead of a silent replay.
- **Handles.** They are synced per entry. Two people creating objects at the same moment can be given the same short handle (`o17`) for different objects, which could confuse a later chat reference. UniqueIds never collide.
- **Duplicate record keys.** Two alarms with the same trigger, type and record type, or two bindings on the same target and property, collapse to one record in sync.
- **Lock steps.** If another person takes the screen within about a second of a run finishing, the requester's stream may miss the run's last steps. The proposal itself still arrives.
- **Proposals vs edits.** Proposals and decisions are pushed live; comments still refresh every 10 s while the list is open.
- **Gating outside the workspace canvas.** The Plant, Standards, Settings, Templates and Validation pages are not gated by `useCanEdit()`; the server still refuses non-editors.
- **No UI to edit a comment's body**; the API supports it.
- **"is editing" location.** The label appears on the canvas, not in the inspector.
