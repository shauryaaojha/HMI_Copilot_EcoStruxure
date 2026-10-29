# Research: split generation, editing and deletion into services?

Question (Shaurya, 2026-10-23): should generation, deletion, editing and the other write paths become separate services with their own workflows? Research only; nothing implemented.

Code read on `review/screens-first` (origin/feat/screens-first, c17d359) on 2026-10-23.

**Status (2026-10-23):** P0 done: both adoption bugs fixed, and a screen delete that left dangling bindings and composites is fixed too (`tests/refs-cascade.test.ts`). P1 started: reference rules and cascades moved to `web/src/lib/refs/index.ts`, used by `adoptTags`, `removeObjects` and `removeScreen`. P2 (store slices) and P3 (start states) not started. Uncommitted, on `review/screens-first`.

## Recommendation

**Do not split into separate deployed services now.** Do split the code into clearer modules along the seams that already exist, and split out one thing: long-running generation, when it needs to be.

Reasons below. The short version: the project is one document, one undo history, and one collaboration stream. Separate services would have to share all three over the network, and the app would become harder to change, not easier.

## What the code looks like today

| Part | Where | Size / shape |
|---|---|---|
| App | one Next.js app, one Vercel project (`web`) | `memory: vercel-single-deployment` |
| Project state | `web/src/store/project.ts` | 1459 lines, one Zustand store, holds screens, variables, bindings, alarms, composites, programs, equipment, objectMeta, plant, tagImport |
| Write path | `web/src/lib/ai/applier.ts` `applyOps` | one function; used by chat, inspector and tests. 13 files import `applier` or `ops` |
| Op language | `web/src/lib/ai/ops.ts` | one zod union, `OP_NAMES` covers add, edit, move, delete, bind |
| Collaboration | `web/src/lib/collab/changes.ts` | diffs two store snapshots into `StoreChange`s; `server/repo-collab.ts`, `repo-live.ts` (SSE) |
| Generation | `lib/ai/pipeline.ts`, `draft.ts`, `regenerate.ts`, `expand.ts`, `lib/program/*` | the pipeline emits events and ops, then `applyOps` |
| Deletion | `deleteScreen`, `deleteObject` in the same op union; cascades are written by hand in several store actions | the cascade is the risky part, see below |
| Renames | `store/project.ts` `adoptTags` (~line 1210) | retags bindings, alarms, composites, programs, equipment |

## Why not separate services

1. **One document.** The .eote is a single project file. A generation service, an edit service and a delete service would all write to it, so they would need one lock, one version, and one merge rule. Today the store and `applyOps` already give that.
2. **One undo history and one op log.** Collaboration (`collab/`) and undo both work from store changes. Across services they would need a shared log with ordering, which is a larger system than the app itself.
3. **Stateless functions.** Vercel functions keep no state between calls (AGENTS.md). Each cross-service call would be a network hop that reloads the project.
4. **Size of team and product.** This is a small team, with one customer relationship and no separate scaling problem. Separate deploys would add cost for each change, with no current gain.
5. **The seams are already there.** Every write goes through `applyOps`, and collaboration is built from store diffs. Splitting the code along those lines gives most of the benefit at no deployment cost.

## Where the split does help: the cascades

Deletion and rename are not independent. Deleting a tag, a screen or an object must also clean up bindings, alarm triggers, composites, programs, equipment and objectMeta. Today each store action does this by hand. `adoptTags` shows the pattern, and it also shows the risk: today's testing found two bugs in it (see below).

Proposal: one module, `lib/refs` (or `lib/model/refs`), that owns every reference in the project and every cascade. Rename, delete and "placeholder adopted" call it. A test that lists every place a tag, screen or object can be referenced then fails whenever someone adds a new one without updating the cascade.

## Where a real service may earn its place later

**Long-running generation.** A full generation or critic pass can run longer than a request. AGENTS.md says durable agent loops should use Workflow plus Sandbox. If generation starts to time out, move that one part to a background workflow. It writes its ops back through the same `applyOps`. That is the one split worth making, and only when a timeout or cost problem shows up.

## Proposed module shape (no separate deploys)

1. `core/model`: the project document types and `lib/refs` cascades.
2. `core/ops`: the op union and `applyOps`, the only write path.
3. `generation`: pipeline, draft, regenerate, expand. Produces ops; never writes the store directly.
4. `binding`: binder, proposals, adopt. Uses `core/refs` for renames.
5. `io`: .eote reader and packager, import and export.
6. `collab`: changes, sync, proposals, presence.
7. `workflows` (UI and state): how a project starts (tags first, screens first, opened file). The `assumed` / `pending` flag from the screens-first work is the first sign of an explicit workflow state. Make it a named state, not a flag.

Store split: once `core/refs` exists, split `project.ts` into Zustand slices by domain (screens, objects, tags and bindings, alarms and composites, collab). Keep one store, so undo and collab still see one history.

## Phased plan

- **P0 (now, small):** fix the two bugs found in testing (below). Add the reference-coverage test.
- **P1:** create `lib/refs` and move the cascades in `deleteObject`, `deleteScreen`, `adoptTags` and renames into it.
- **P2:** split `project.ts` into slices, one domain at a time, each with its own tests. No behaviour change.
- **P3:** name the project start states (`tags`, `screens`, `assumed`, `opened`) and route the start pane and tag import through them.
- **P4 (only when needed):** move long generation to a background workflow.

Each phase is a separate PR, and the suite must stay green at each step (baseline: 1173 passing on the review branch).

## Bugs found while researching (today's testing)

Both are in `adoptTags` and are covered by `web/tests/screens-first-adopt.test.ts`. The two tests are red on the review branch on purpose.

1. **Display text is renamed.** Any string equal to a placeholder name is rewritten, including a caption. `retag` cannot tell a tag reference from a label. Fix: rename only the known reference fields (the composite and program tag props), not every string.
2. **A reference is blanked.** A reference whose placeholder matched no real tag becomes `""`. Fix: keep the placeholder name as an intent (the way bindings already do), and report it as unbound.

## Open questions for Shaurya

1. Is the module split (P1 to P3) worth doing before the next feature, or after the next customer demo?
2. Should generation become a background workflow now (P4), or wait until it times out?
3. Who owns `lib/refs` once it exists, given Pranav is working on the screens-first flow?
