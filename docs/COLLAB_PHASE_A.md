# Collaboration Phase A

Accounts, private server projects, permanent original files, revision history and
chunked uploads now sit behind `web/src/lib/server/repo.ts`. The existing zustand
store and localStorage format remain the editor's device cache. The format
reader, writer, schema and canvas are unchanged.

## Running it

- Without `AUTH_SECRET`, a laptop uses the implicit `local` engineer. Without
  MongoDB it writes under `web/.data/`, which is gitignored. Nothing requires an
  external service for this mode.
- With `AUTH_SECRET` set, Auth.js v5 uses JWT sessions and the only way in is an
  email and a password held by this installation (decision A in
  PLAN_FULL_ARCHITECTURE.md; GitHub and Google were removed). Account ids are
  `user:<24 hex>`. Sign up, sign in and sign out are in the shell and Projects,
  and on `/signin` for share links that need to return to themselves.
- On Vercel, no `AUTH_SECRET` means browser-only projects and no implicit user.
  Server storage requires MongoDB; it never falls back to ephemeral disk.
  Visitors who are signed out retain the existing anonymous import path.

Environment variables (also documented in `web/.env.example`):

| Variable | Meaning |
| --- | --- |
| `MONGODB_URI` | Existing MongoDB connection; required for server storage on Vercel |
| `MONGODB_DB` | Optional database name; defaults to `hmi_copilot` |
| `AUTH_SECRET` | JWT secret, and the switch that turns accounts on at all |
| `AUTH_URL` | Optional canonical URL for custom proxy deployments |
| `AUTH_TRUST_HOST` | Optional trusted-proxy setting; Vercel is inferred |
| `VERCEL` | Host-provided deployment flag; do not set for laptop local mode |

No credentials belong in browser variables, and `AUTH_SECRET` is an environment
variable on every environment, never a committed value. See the
[Auth.js setup reference](https://authjs.dev/reference/nextjs).
MongoDB must support transactions (a replica set, including Atlas, or a sharded
cluster). All callers reuse the existing cached MongoClient.

## Data and access

`Repo` exposes users, projects, versions, members, sources and upload staging.
`MongoRepo`, `FileRepo` and `MemoryRepo` implement the same contract. Another
database implementation can be added without changing API or editor callers.

| Collection / directory | Records |
| --- | --- |
| `users` | Stable id, email, name, image and creation time |
| `projects` | Owner, name, target, timestamps, integer rev, sourceId and layout |
| `versions` | Project, revision, author, label, timestamp and persisted snapshot |
| `members` | Project/user pair, owner/editor/commenter/viewer role and addedAt |
| `sources` | Private source metadata and original bytes; permanent for accounts |
| `uploads`, `uploadParts` | Declared size, uploader, numbered parts, expiry and completion handle |

Mongo bytes live in the `sources` GridFS bucket. Local bytes live in
`.data/sources/<id>.bin`; metadata lives in named directories with an atomic
write-ahead journal and an exclusive filesystem lock. If a local process dies
holding `.data/.lock`, stop its writer before removing that lock; the next
transaction replays any committed journal. The FileRepo is for local use, not
shared network filesystems.

The owner membership is created with the initial version. `access.ts` is the
single role matrix: everyone may read/export, commenters may comment, editors
may edit, only owners may manage/delete. Uploads have no project yet, so they
check uploader identity instead. Anonymous handles are unguessable bearer
capabilities. Permanent source reads require the uploader or membership in a
project/version referencing the source. Project pictures use the same checks
and private cache headers. Private account imports do not enter the shared
knowledge index.

Legacy struct imports retain their original as `sourceId`, but keep `source`
unset: their established export behavior still creates a converted project.
Typed imports use `source` for writing back into the original archive.
Uploading an existing local project promotes an available anonymous original
to permanent storage. An expired original must be reopened first.

## Saving and uploads

`/api/me` discovers identity and cloud availability. `/api/projects` lists owned
and shared projects and creates them. The per-project endpoint reads, saves or
deletes; `/versions` lists history and restores an earlier revision as a new
authored save. Saves and history commit together, retaining the latest 50.
PUT compares the supplied revision and returns 409 with the current revision
and snapshot on a mismatch.

The editor keeps localStorage as a write-through offline cache and debounces
server saves for 1.5 seconds after a persisted change. Revision baselines stay
in each tab, so another tab's cache metadata cannot silently advance them.
Conflicts preserve the local copy and pause writes until Reload or Keep yours.
Going online retries pending work; dirty work is checked again on reload.
The Projects screen lists server projects first and offers Upload to cloud for
device-only projects. Sharing arrived in Phase B, below.

Files above 4 MiB use POST `/api/upload`, numbered raw PUT parts of at most
4 MiB, then POST `/complete`; `/api/import` accepts the returned uploadId.
Completion is idempotent and checks every part against the declared size and
the existing 100 MiB aggregate ceiling. Incomplete uploads and anonymous
sources expire after 24 hours. Expiry is checked on access; staging bytes are
reclaimed opportunistically on later upload creation. Permanent sources are
retained independently of project deletion. Anonymous small imports keep the
existing 24-hour store, including its legacy BSON size bound; large browser
uploads use the new binary path.

## Verification and later phases

Vitest covers MemoryRepo and temporary FileRepo, concurrent saves, 50-version
retention, restore, the role matrix, source isolation, API errors, session modes,
chunk assembly/expiry and importing the demo file through uploadId. Client
tests cover debounce, two-tab conflicts and offline recovery without network.
OAuth provider redirects and real MongoDB transactions require an environment
with credentials and were not exercised by those tests.

Phase B can add invitations, sharing links and membership management on these
records. Phase C can add live operations and merging, including an AI agent
acting with explicit membership. This phase deliberately uses whole snapshots
and conflict prompts; it does not implement live merging or agent collaboration.

## Phase B: share links and comments

### Share links

An owner opens **Share** in the project header. The dialog lists the members
(the owner can change a role or remove someone; the owner stays owner), the
project's links, and a form for a new one: a role (viewer, commenter or
editor), an expiry in days (default 14, at most 90) and whether the link may
export (default off for a viewer link, on otherwise).

A link is `/s/<token>`, where the token is 32 random bytes in base64url. The
`shares` collection keeps only its SHA-256 (`_id`), with the project, role,
creator, creation and expiry times, the export flag and `revokedAt`. Because
the server cannot give a token back, the dialog shows it once and keeps a copy
in the creating browser's localStorage so Copy works there; in another browser
the link says it was created on another device. Revoking keeps the record.
Expiry and revocation are judged by the repository's clock.

| Visitor | Link | Result |
| --- | --- | --- |
| Signed in | any live link | Added to `members` with the link's role, never lowering a higher one; redirected to `/project/<id>` |
| Signed out | viewer | Read-only view at `/s/<token>`; `POST /api/shares/open` sets the HttpOnly `hmi_share` cookie holding the token |
| Signed out | commenter / editor | A sign-in request that returns to the link |
| Anyone | expired, revoked, unknown | A page saying which, and that the owner can send a new one |

`accessOf()` and `can()` in `src/lib/server/access.ts` take the request's cookie
tokens. A live viewer link grants read (and export only if the link allows it)
on its own project to a signed-out visitor; a cookie never grants comment,
edit or manage. A member who joined through a link without export keeps that
restriction (`exportDenied` on the membership). `GET /api/projects/[id]` now
also returns `access: { role, actions, via }`, which the editor keeps in
`src/store/access.ts`. Pictures of an opened file are readable through the
viewer link of a project that references the file.

### Read-only editing surface

`useCanEdit()` (src/store/access.ts) is the one question every editing
affordance asks: canvas tools, Insert, the screen strip, move/resize/draw on
the canvas (`readOnly` on ScreenRenderer and ScreenBoard, separate from
`interactive` so selection and the inspector still work), the context menu,
editing shortcuts, inspector editors (a disabled fieldset), the layers panel,
the library, the chat composer and proposal buttons, the project name, tag
import and the start pane. Browser-only and laptop projects have no access
record and behave as before. The routes' checks remain the rule.

### Comments

`comments` records: project, optional screen, object (UniqueId) and canvas
point, author, plain-text body (at most 4,000 characters), creation and edit
times, `resolvedAt`/`resolvedBy`, and `parentId` for one level of replies. A
reply sits where its thread is pinned.

| Route | Who |
| --- | --- |
| `GET /api/projects/[id]/comments` | anyone who can read, including a viewer link |
| `POST /api/projects/[id]/comments` | signed-in commenter, editor or owner |
| `PATCH .../comments/[cid]` `{ resolved }` | commenter and up; `{ body }` the author only |
| `DELETE .../comments/[cid]` | the author, or the owner; a thread takes its replies |

The canvas Comments toggle turns a click into a new pinned comment. Pins are
numbered and drawn above the objects, outside the object groups, so they are
never selected or exported. A side list per screen holds threads, replies,
resolve/reopen and a "show resolved" filter. Comments are fetched when the
list opens and every 10 s while it is open.

The sign-off report lists unresolved comments per screen for a shared project:
the editor sends the project id and the report route checks read access.

Other routes: `GET /api/projects/[id]/members`, `PATCH|DELETE
/api/projects/[id]/members/[userId]`, `GET|POST /api/projects/[id]/shares`,
`DELETE /api/projects/[id]/shares/[shareId]`, `POST /api/shares/open`, and the
page `/s/[token]`. Tests: `tests/shares.test.ts`, `tests/comments.test.ts`,
`tests/readonly.test.ts`.

## Phase C: live co-editing

### Design

Vercel functions are stateless and cannot hold WebSockets, and no realtime
vendor is used. Editing is a **server-authoritative operation log over plain
HTTP**, pushed with **Server-Sent Events**. Expected latency is about one
second (the stream polls the log once a second), which suits engineering work.

**Edit unit.** A `Change` is `{ id (client uuid), base: rev, author, ops }`,
where each op is a `StoreChange` (src/lib/collab/types.ts) at the granularity
of one part or one record: `setPart` (the whole part), `removePart`,
`reorderParts`, `addScreen`, `removeScreen`, `renameScreen`, `setScreenProps`,
`reorderScreens`, `setVariable`/`removeVariable` (by name),
`setAlarm`/`removeAlarm` (by `alarmKey`, with a message-based fallback when an
alarm has no trigger), `setBinding`/`removeBinding` (by target id + property),
`setEntry`/`removeEntry` for keyed maps (objectMeta, screenPlacement, handles,
composites, programs, foreign) and `setField` for whole values (name, target,
standards, plant, tagImport, source, sourceId, layout, handleSeq). The shared
document is the snapshot minus what is personal: the conversation, the in-app
version list, the save stamp and the active screen stay in each browser.

Changes are not produced by rewriting store actions. `src/lib/collab/changes.ts`
(pure, tested) diffs the shared slice before and after every committed store
action (reference comparison first, so it is cheap with immer's structural
sharing) and applies changes idempotently. A pure reordering of variables,
alarms or bindings is not synced; duplicate keys collapse to the last one.

**Conflict rule: last writer wins per part or record.** The server applies
changes in the order they arrive, whatever base they were made against. A
whole-part `setPart` replaces the part; so `removePart` beats a concurrent
`setPart` on the same part only when it is newer by rev, and a `setPart`
arriving after a removal brings the part back. A change that cannot apply (a
part on a deleted screen, a malformed op) is rejected with a reason.

### Server

`POST /api/projects/[id]/changes` `{ base, changes[] }` (editors): applied in
order to the latest snapshot, one revision per accepted change, appended to
`changes` (`{ projectId, rev, change, author, at }`), answering
`{ rev, accepted, rejected: [{ id, reason }] }`. The author is always the
signed-in user. A retried change id is accepted without being applied twice.
The latest snapshot lives in `heads`; `versions.current()` returns whichever of
head and last saved version is newer, so Phase A readers see live edits. The
log keeps 2,000 changes per project; older ones are already in the head. A
live session leaves a "Live edits" version in history at most every 10
minutes (50 versions are kept, as before).

The per-project lock is the storage transaction around read-apply-write:
MongoDB retries the transaction when two writers touch the same project
document (in effect a compare-and-set on its rev), the file store holds its
exclusive process lock, and the memory store queues. A `findOneAndUpdate`
loop was not added because the transaction already provides it.

`GET /api/projects/[id]/stream?since=rev` (anyone who can read): SSE with
`change` events after `since`, `presence` when who-is-where changes, and
`reset` with the head snapshot when `since` is older than the retained log or
the project was saved or restored whole. Each connection ends within 55 s
(`maxDuration = 60`) with a `ping`; the client reconnects from its last rev.

`POST /api/projects/[id]/presence` `{ screenId, selection, cursor? }`: a
heartbeat every 5 s (and at most once a second while the pointer moves),
counted for 15 s and broadcast on the stream.

Export of a shared project sends `{ projectId, rev }`; the export route
packages the server snapshot at that revision (rebuilt from a version and the
log if needed), never the browser's copy. Export refuses while this tab still
has unconfirmed changes.

### Client

`src/lib/collab/sync.ts` (`CollabSession`) subscribes to the store, queues
local changes and POSTs them merged every 300 ms; remote changes are applied
without being captured again, and pending local changes are replayed on top
(rebase). Undo stays per person: while a session runs, the store's undo/redo
are replaced by ones that send the inverse of this person's own last change.
A refused change makes the session reload the server snapshot and say so.
The whole-snapshot PUT save stands down for a live project.

`useCollab` starts a session only for a server project (one with an access
record); browser-only and laptop projects are unchanged. Viewers and
signed-out link visitors listen without sending. The header shows who else is
here; the canvas outlines other people's selections in their colour with
"<name> is editing" and shows their pointer on the same screen. The outline
is a soft lock: the part stays editable.

Tests: `tests/collab-changes.test.ts`, `tests/collab-server.test.ts`,
`tests/collab-sync.test.ts`, `tests/presence-ui.test.ts`.

## Phase D: the Copilot as a collaborator

**Identity.** The agent's author id is `agent:<provider>:<model>` (or
`agent:none:local` with no model) and its display name "HMI Copilot". Every
change it makes carries that author in the Phase C log, with `acceptedBy` set
to the editor who accepted it. Parts it creates, and generator-placed parts it
changes, keep `origin: "generated"` in ObjectMeta.

**Proposals are shared.** In a shared project a chat edit is never committed
to the document. The browser sends the model's ops to
`POST /api/projects/[id]/proposals`; the server dry-runs them with the chat's
own applier on a scratch store built from the latest snapshot and stores a
`proposals` record: project, screen, requester, request text, ops, one label
per op, the resulting StoreChanges, what could not be done, timestamps and
`status: open | accepted | partially-accepted | discarded` with `decidedBy`,
`decidedAt`, `acceptedOpIndexes` and the landing rev. Proposals are broadcast
as `proposal` events on the project stream; the chat panel lists them for
every member and the newest open one is drawn as ghosts with the existing
preview rendering.

**Who decides.** Editors and the owner accept (ticking ops) or discard, via
`POST /api/projects/[id]/proposals/[pid]` `{ action, indexes? }`. Accepting
runs only the ticked ops again on the snapshot as it is then, and sends the
result through the normal change path authored by the agent. Commenters can
comment on a proposal (a project comment carrying `proposalId`); viewers see
it. Every decision is appended to `decisions`, and the sign-off report gains
the table "AI-suggested changes and who accepted them".

**One agent turn per screen.** `agentLocks` rows `{ projectId, screenId,
holder, expiresAt (90 s) }`. A chat turn takes its screen with
`POST /api/projects/[id]/agent/lock` before asking the model and gives it back
when its proposal is made (or with `DELETE`); a second person is told
"Copilot is working on this screen for Ravi" (409, code `busy`). A crashed
turn holds the screen for at most 90 s.

**Server-side runs.** `POST /api/projects/[id]/agent` `{ screenId, mode:
"build" | "repair", goal }` takes the screen, answers 202, and runs
`runAgent` (src/lib/agent/loop.ts) after the response with Next's `after`
(waitUntil on Vercel). `build` builds from the project's tags; `repair` starts
from the server snapshot (`from`) and repairs it. No bench and no packaging on
the server (`prove: false`). Its steps are written onto the screen's lock row
and reach the requester as `agent` events on the stream; its result is a
proposal whose changes are one fixed group, accepted or discarded whole.

Browser-only projects keep today's behaviour: commit, or a local proposal on
the chat message.

Tests: `tests/proposals.test.ts`, `tests/agent-lock.test.ts`,
`tests/collab-agent.test.ts` (two simulated browsers receive the proposal and
see only the accepted change). No test calls a model (`AI_PROVIDER=none`).
