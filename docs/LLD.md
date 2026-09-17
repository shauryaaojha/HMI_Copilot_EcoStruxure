# HMI Copilot, low-level design

*The conversation loop, the context, the orchestration, and how a screen is updated.
Written 17 September 2026 against `web/` at `ecda94d`. Companion to
`REENGINEERING.md`, which says what the product is; this says how the loop that
edits screens is built, and first, why the current one goes wrong after two turns.*

---

## 0 · Scope and the one-line diagnosis

The conversation degrades after two or three requests because the model is asked to
do the wrong job with the wrong memory: it is handed a flat list of boxes with
coordinates, told the screen is full, remembers only the prose of what it said and
not what actually happened, refers to objects by names the store silently changed,
and is, on the demo machine, a small fast model. None of that is one bug. It is a
loop design that works for one turn and accumulates error after that.

The fix is not a better prompt. It is: **the model edits a model, not a canvas.** It
speaks in stable handles and placement slots, the layout engine does geometry, every
turn is dry-run and verified before it touches the project, and the history the
model sees is the record of what happened, not what was said.

---

## 1 · Why it breaks: root causes, with evidence

Each of these is in the code today. Together they explain "bakwaas changes after
two prompts".

### 1.1 The model doing the work is the smallest one available

`web/.env.local` sets a Gemini key and `GEMINI_MODEL=gemini-flash-lite-latest`.
`activeProvider()` in `src/lib/ai/plan.ts:139` returns Gemini whenever its key is
set, before checking for Claude. So every conversational turn in the demo is
Flash Lite, at temperature 0.3, asked to reason over a 245-object project and emit
coordinates. Provider selection by "which key exists" is a demo convenience that
became the production path.

### 1.2 The model is asked to do geometry, then told the screen is full

- `converse.ts` `prompt()` lists every object as `name[Type left,top WxH]` and asks
  the model to choose `left`/`top` that "fit inside the panel, do not overlap, line
  up with neighbours, multiples of 8".
- `freeSpaceHint()` in `src/lib/ote/place.ts` reports only "below everything" or
  "to the right". A generated screen has an alarm banner at the bottom and cards to
  the right edge, so on turn two the hint is: *"The screen is full - place a new
  object only if you also move something."* That sentence is an instruction to
  emit `moveObject` ops on things the engineer did not mention. That is the
  "bakwaas".
- When the model does give coordinates, `avoidContent()` slides the object up to
  24 rings × 8 = 192 units sideways, then in every direction, to dodge content. The
  object lands somewhere the model did not say. Next turn, the model's picture of
  the screen is wrong by that much.
- When it gives none, `freeSpot()`'s third pass returns "the position covering the
  least of what is already there", which on a full screen means on top of something.

### 1.3 The model's memory is prose, not outcomes

`useChat.ts:94` sends the last 12 messages as `{role, text}`. `text` is the model's
own one-sentence reply. The `changes` and `problems` that `applyOps` produced are
stored on the message (`store/types.ts:124`) but **never sent back**. So the model
remembers "I moved the flow reading clear of the banner" and does not learn that
the op failed with "No object called Flow_Display", or that the object was renamed,
or that the position was shifted. Every turn its belief drifts further from the
store, and it edits the belief.

### 1.4 Names are not stable, and resolution is fuzzy

- `appendObject` (`store/project.ts:463`) renames on collision via `uniqueName`:
  the model asks for `Lamp_1`, the store creates `Lamp_2`. `applyOps` patches this
  *within one batch* through its `created` list, but on the next turn the model
  still says `Lamp_1`.
- `addScreen` and `ensureScreen` do the same to screen names.
- `resolve()` in `applyOps.ts` falls through to a substring match on squashed names
  (`squash(part.Name).includes(needle)`). "Pump" resolves to any single object whose
  name contains it. The match is reported as success with the model's own note, so
  the engineer cannot see that the wrong object was edited.

### 1.5 A second "build" appends a second plant

`useChat.ts:141` runs `generate(intent, { fresh: before === 0 })`. Any turn the
model classifies as `build` after the first appends a whole new screen set;
`ensureScreen` creates fresh screens and `uniqueName` turns `PumpStation1` into
`PumpStation1_2`. The prompt defines `build` as "they want a whole screen laid out",
which a request like "now give me the dosing screen" satisfies. Result: duplicate
screens, duplicate bindings, and a navigation strip listing both.

### 1.6 The model cannot see most of the tags

`digestOf` sends `variables.slice(0, 120)`. On the 1,248-tag sample the model sees
under ten percent of the tag list, so `bindTag` and `addAlarm` fail on anything else,
and the failure is only visible as a problem line the model never receives (§1.3).

### 1.7 A turn is not a transaction

`applyOps` applies each op through a store action; each action calls `remember()`
and pushes its own undo step. Ten ops are ten undos. A turn with three good ops and
two bad ones applies the three and reports the two; nothing is previewed, nothing
is rolled back, and `snapshot()` is taken *after* the damage.

### 1.8 The whole context is one user message, rebuilt every turn

`prompt()` concatenates project digest and conversation into a single string sent as
one user message. There is no cacheable prefix, no real turn structure for the model
to attend to, and the "selected right now" and free-space lines describe the active
screen while an op with no `screen` field also targets the active screen, which the
model may have just changed by `addScreen` without the active screen following.

---

## 2 · Phase 0: fix the loop that exists

These are ordered so each one stands alone, each has a test, and the whole set can
land in a week. Nothing here waits for the Plant Model.

### F1 · Stop choosing the model by which key exists

Explicit `AI_PROVIDER=claude|gemini|none` and `AI_MODEL`. Conversation defaults to
`claude-opus-5`, adaptive thinking, `output_config.effort` `medium` for edits and
`low` for routing. Gemini stays available as an explicit choice. The timeline and
the reply keep naming the provider, as now.
*Test:* provider resolution table; a Gemini key alone with no `AI_PROVIDER` yields a
visible "no conversational provider configured" rather than a silent Flash Lite.

### F2 · Handles, not names

Every screen and object gets a short stable handle (`s1`, `o17`) stored in
`objectMeta`, assigned once at creation, never reused. The digest and the ops use
handles; the display name is shown beside it for readability
(`o17 "Lamp_PMP101_RUN"`). `resolve()` becomes exact-match on handle, then exact on
name, then **stop**: an unresolved reference is a rejected op, and the rejection
names the three closest handles so a repair pass can fix it.
*Test:* the substring fallback is deleted and a test asserts "Pump" against a screen
with one pump object is rejected, not applied.

### F3 · Placement slots instead of coordinates

Remove `left`/`top` from `addObject` and `addEquipment`. Add:

```ts
place?: {
  screen?: string;                       // handle; default active
  region?: "header" | "nav" | "body" | "alarms" | "footer";
  anchor?: string;                       // object handle
  side?: "rightOf" | "leftOf" | "below" | "above" | "inside";
  order?: "first" | "last";
}
```

The layout engine owns the region grid it already draws (`HEADER`, `NAV`, `FOOTER`,
`MARGIN`, `GAP`, card grid in `layout.ts`) and resolves a slot to a box. If the
region has no free cell, the op is rejected with "body is full on s2; say which card
to replace or ask for a new screen", which is a sentence the engineer and the model
can both act on. `moveObject` keeps coordinates **only** when the engineer typed
numbers; otherwise it also takes a slot. `avoidContent`'s 192-unit drift and
`freeSpot`'s overlap pass are deleted.
*Test:* every op in a 30-turn recorded transcript lands inside the panel, in its
region, overlapping nothing but its background rectangle.

### F4 · History is outcomes

The assistant side of history becomes the structured turn record:

```ts
{ role: "assistant", turn: { mode, ops: [...], applied: ["o31 Lamp added below o12"],
  rejected: [{ op, reason }], renamed: [{ asked: "Lamp_1", became: "o31" }] } }
```

serialised compactly, plus the one-line reply. Beyond eight turns, older turns
collapse to a one-line **state anchor** ("turns 1–6: built s1–s3, added o30–o44,
removed o8") regenerated deterministically from the op log, not by the model.
*Test:* a recorded transcript where turn 2's op was rejected; turn 3's prompt must
contain the rejection.

### F5 · Build on an existing project is "extend", never a second plant

`build` is allowed only when the project has no screens. Otherwise the router
returns `extend` and the planner receives the existing screen index (handles,
levels, equipment placed) and returns a **delta**: screens to add, equipment to add
to which screen. `generate` never runs with `fresh: false`. "Start over" is its own
mode and asks once.
*Test:* two consecutive build-like requests produce no duplicate screen names and
no duplicate bindings.

### F6 · Tags by lookup, not by dump

The digest carries the **equipment list** (id, class, label, roles) and the tag
count. The full tag list is reachable through a tool `find_tags(query, limit)`
served locally over the store; the model calls it when it needs a tag that is not
already on an equipment card. Same for `find_objects(query, screen?)`.
*Test:* on the 1,248-tag sample, "add an alarm on the backwash high level" binds the
right tag without it being in the initial context.

### F7 · A turn is a transaction with a dry run

```
ops → applyOps(draft clone) → outcome{applied, rejected, diff}
   → if rejected.length > 0 and repairs < 1: one repair call with the rejections
   → quick rules (naming, binding, panel bounds, object limit) on the draft
   → proposal shown (ghosted diff) or auto-commit per setting
   → commit as ONE undo step, snapshot before, turn record written
```

`remember()` gains a batch mode so a turn is one undo. Nothing touches the live
store until commit.
*Test:* a turn with one bad op leaves the store byte-identical until the repaired
turn commits; undo after a five-op turn restores everything in one step.

### F8 · Real message structure and a cached prefix

System prompt (rules, op and slot vocabulary) as a stable string; project context
(Standard, equipment list, screen index) as the first user content block with
`cache_control` and a one-hour TTL; per-turn volatile block (active screen detail
with handles and free slots per region, selection, last outcome) after the
breakpoint; history as alternating messages. `usage.cache_read_input_tokens` is
logged per turn and shown in a debug panel.
*Test:* two consecutive turns on an unchanged project show a cache read on the
second.

### F9 · Transcript replay tests

Record ten real multi-turn sessions (request, model output, store before) into
`tests/transcripts/*.json`. Replay them through the applier with the model output
fixed. Assert per turn: no object outside the panel, no content overlap, no
duplicate names, no dangling bindings, no object moved that was not named in the
ops. This is the regression net for everything above, and it runs without a key.

Order of landing: F1, F7, F2, F3, F4, F5, F6, F8, F9. F1 and F7 alone remove most
of the visible damage; F2 to F4 remove the drift; F5 and F6 remove the two
structural failures; F8 makes it affordable; F9 keeps it fixed.

### Status (17 September 2026)

All nine landed in one pass. 504 tests, typecheck and `next build` clean.

| Fix | Where | Test |
|---|---|---|
| F1 | `lib/ai/provider.ts`; `AI_PROVIDER` / `AI_MODEL` in `.env.example` | `tests/pipeline.test.ts` provider selection |
| F2 | `store/project.ts` handles; `lib/ai/applier.ts` exact resolution with nearest-handle rejections | `tests/conversation.test.ts` handle and substring cases |
| F3 | `lib/ote/regions.ts` regions, slots, `roomReport`; `place.ts` reduced to `clampToPanel` | `tests/regions.test.ts` |
| F4 | `ChatMessage.turn` record; `converse.ts` history as outcomes with an anchor line | `tests/context.test.ts` |
| F5 | `extend` and `startOver` modes; `runPipeline({ existing })` plans only unplaced units | `tests/extend.test.ts` |
| F6 | `lib/ai/retrieve.ts`; digest carries equipment plus retrieved tags | `tests/conversation.test.ts` retrieval case |
| F7 | `createProjectStore`, `commitBatch`, `dryRun` / `commit`, one repair pass, proposal UI in `ChatPanel` | `tests/transcripts.test.ts` dry-run and one-undo checks |
| F8 | system and project block with `cache_control` (1 h); usage on every message | cache read shown in the UI |
| F9 | `tests/transcripts/*.json` replayed against the invariants | `tests/transcripts.test.ts` |

Not yet done from §2: the `find_tags` lookup tool (retrieval is deterministic
pre-selection for now), ghosted diff rendering on the canvas (the proposal is a
list with accept and discard), and the ten *real* recorded sessions (the three
transcripts are hand-written and cover the failure modes, not live model output).

---

## 3 · The production loop

Everything in Phase 0 is kept. This section is what it grows into once the Plant
Model from `REENGINEERING.md` §3 exists.

### 3.1 Data model: the op log is the source of truth

The project is event-sourced. The store state is a projection of an append-only op
log; undo is a pointer into it; the audit record is it; sync between two machines
(later) is it.

```ts
interface Op {                       // every change, human or model
  id: string;  at: number;  by: "engineer" | "model" | "layout" | "import";
  turnId?: string;                   // which conversational turn, if any
  kind: OpKind;  payload: ...;        // the same vocabulary the model uses
  inverse: Op;                       // computed at apply time, for undo
}
interface Turn {
  id: string;  request: string;  mode: Mode;
  contextHash: string;               // what the model saw
  model: { provider; id; effort; usage: { in, cached, out } };
  proposed: Op[];  applied: Op[];  rejected: { op: Op; reason: string }[];
  findings: Finding[];  decision: "auto" | "accepted" | "partial" | "rejected";
  versionAt: number;
}
```

Handles are allocated by the log (`o{n}` monotonically), so a handle in turn 3 means
the same object in turn 30 whether it was renamed, moved or regenerated.

### 3.2 Context engineering

The context is built in layers with an explicit token budget per layer. It is
assembled by one function, `buildContext(project, turnState)`, that is unit-tested
for size and for cache stability.

| Layer | Content | Cached | Budget |
|---|---|---|---|
| **System** | role, safety lines, op and slot vocabulary, output schema notes, ISA-101 summary in six lines | yes, permanent | ≤ 2k |
| **Standard** | the active style guide as data: palette names, region layout, faceplate layouts per class, naming rules | yes, per project | ≤ 2k |
| **Library** | equipment classes: roles, default parts, default alarms | yes, per project | ≤ 3k |
| **Project index** | hierarchy; screens (handle, name, level, region occupancy, equipment placed); equipment instances (id, class, label, screen); alarm count; device summary | yes until structure changes (hash) | ≤ 3k |
| **Volatile** | active screen detail (objects with handle, type, region, anchor relations, bound tag); selection; free slots per region; last turn's outcome | no | ≤ 2k |
| **History** | last 8 turns as structured records; older turns as one state anchor line | no | ≤ 2k |
| **Tools** | `find_tags`, `find_objects`, `describe_screen`, `describe_equipment`, `style_rule` | schema cached | ≤ 1k |

Rules that keep it honest:

- **Positions are never in the context** unless the engineer typed a number. The
  model sees regions, anchors and order ("o17 is rightOf o12 in body"). It cannot
  do arithmetic on what it cannot see.
- **The screen is never "full".** Free slots are listed per region; when a region
  has none, the volatile block says "body: 0 free cells (6 cards); a new card
  needs a new screen or a replacement", and the op vocabulary has `replaceEquipment`
  and `addScreen` to say so.
- **Every renamed or shifted thing is reported back** in the outcome, so the model's
  next belief starts from the truth.
- **Retrieval beats dumping.** Anything with more than about 40 entries is behind a
  tool. The model asks for what it needs and the tool result is small.
- **Cache-stable ordering.** Every list in the cached layers is sorted by handle;
  no timestamps, no selection, nothing volatile above the breakpoint.
- **Selection is scoped.** "Selected: o31, o32 on s2" and "active: s2", both in the
  volatile block, and ops without `screen` resolve to `active`, which the applier
  sets explicitly when it adds a screen.

### 3.3 Orchestration

One turn is a short, bounded pipeline. No open-ended agent loop; the tool calls are
lookups, the number of model calls is at most three.

```
request
  │
  ▼
[1] Route         low effort · structured · {mode, scope, needsLookup}
  │   mode: answer | clarify | edit | extend | startOver
  │   scope: screen handles and equipment ids the request is about
  ▼
[2] Resolve       tools only, no generation: the model may call find_* to fill
  │               scope; results appended as tool_result blocks
  ▼
[3] Propose       medium/high effort · strict schema · ops with handles + slots
  │               (for extend: a delta plan, then deterministic composition)
  ▼
[4] Dry run       applier on a draft → applied / rejected / renamed / diff
  │
  ├─ rejected > 0 and repairs == 0 ──▶ [3'] Repair  (once, with the rejections)
  │
  ▼
[5] Verify        rule packs on the draft (fast subset synchronously, full set in
  │               a worker); findings attached to the turn
  ▼
[6] Decide        auto-commit if: 0 rejected, 0 error findings, ≤ N objects
  │               touched, nothing deleted; otherwise show the proposal
  ▼
[7] Commit        one op-log batch, one undo step, turn record, timeline lines
```

Choices and why:

- **Route and Propose are separate calls** because the router is cheap and its
  output (scope) decides what goes into the Propose context. One giant call that
  both decides the mode and writes ops is what the current code does, and it is
  where "build again" comes from.
- **Strict schemas on every output.** Structured outputs for Propose; `strict: true`
  on the lookup tools. Ids are re-validated against the log after parsing.
- **Repair is bounded to one pass.** A second failure becomes a visible proposal
  with the rejections shown, not another model call. Cost and latency stay
  predictable, and the engineer sees exactly what could not be done.
- **Verification is the rule engine, not the model.** The model is never asked
  "does this look right". Findings come from code and are attached to the turn.
- **Effort per stage.** Route `low`; Propose `medium` for edits, `high` for extend
  on a large project; Repair `low`. Measured on the eval set, adjusted per route.
- **Provider policy.** Conversation runs on `claude-opus-5` by default; the same
  stages run unchanged on a customer's Bedrock or Foundry tenancy or on an on-prem
  endpoint through the seam. A provider that cannot honour the strict schema
  falls to "answer" mode with an explanation rather than to a mangled op list.
- **Streaming.** Propose streams; ops are ghosted onto the canvas as they parse so
  a ten-op turn feels immediate. The commit still waits for the dry run.

### 3.4 Screen updates: the layout engine as reconciler

Today the engine lays out once. It becomes a **reconciler**: given the Plant Model
plus overrides, produce the screen; given a change, re-lay out only the affected
region and preserve everything else exactly.

- **Regions are first-class.** Header, nav, body, alarms, footer per template, with
  a cell grid in body (3×2 cards at L2, 4×3 tiles at L1). A slot resolves to a cell
  or to a position relative to an anchor within a cell.
- **Overrides survive.** An engineer's drag records `override: {handle, box}` in the
  log. Re-layout skips overridden objects and flows around them. Regeneration never
  reverts an override; "reset layout" is an explicit op.
- **Replacement, not accumulation.** `replaceEquipment(cell, id)` and
  `swapEquipment(a, b)` exist so a full screen can change without moving anything
  the engineer did not name.
- **Faceplates are instances.** A card is a compound-object instance with the
  class's layout; changing the class layout in the Standard re-renders every
  instance. An engineer editing one card is offered "this card only" or "the class".
- **Diff, not redraw.** The canvas receives `{added, removed, changed}` handles and
  animates only those, which is also what makes the proposal ghosting cheap.

### 3.5 Proposals and the accept step

A proposal is the turn's `diff` rendered on the canvas: added objects ghosted, moved
objects shown with a from/to line, removed ones hatched, with the findings beside
them. Accept all, accept some (per op), or reject. Auto-commit is a per-project
setting with conservative defaults (§3.3 step 6), and a turn that deletes anything
never auto-commits. Either way the turn record is written, so the audit trail shows
proposals that were declined as well as changes that were made.

### 3.6 Performance

Targets, then the means.

| Target | Value |
|---|---|
| Edit turn, p50 / p95 | ≤ 3 s / ≤ 8 s including verify |
| Input tokens per edit turn | ≤ 10k, of which ≥ 70% cache reads on an unchanged project |
| Canvas update after commit | ≤ 16 ms for a 300-object screen |
| Full rule packs on a 60-screen project | ≤ 500 ms in a worker, never on the UI thread |

- **Cache discipline.** Three breakpoints: after System, after Library, after
  Project index. Project index is rebuilt only when its structural hash changes,
  so a run of edits on one screen reads the whole prefix from cache.
- **Digest memoisation.** `buildContext` layers are memoised on the log length and
  the structural hash; building the volatile block is O(active screen), not O(project).
- **Lookups are indexed.** Tags by name prefix and by equipment; objects by handle,
  by name, by screen. Built once per import, updated incrementally by the log.
- **Verification in tiers.** Synchronous: naming, references, bounds, object limit
  (all O(touched)). Worker: ISA-101, ISA-18.2 and style packs over the project,
  debounced, results merged into the turn when ready.
- **Rendering.** Only the active screen renders live; the board shows thumbnails
  rendered off-screen and cached by screen hash. Parts are memoised by handle and
  version; a 300-object screen re-renders only the diff.
- **Eval and bulk work off the request path.** The golden corpus runs on the Batch
  API at half cost; nothing in the interactive loop waits on it.
- **Token accounting is visible.** Every turn shows tokens in, cached, out, and
  latency per stage in a debug panel. Regressions are seen, not suspected.

### 3.7 Observability and evaluation

- **Per-turn trace** persisted with the turn: context hash, layer sizes, model and
  effort, stage latencies, usage, ops proposed / applied / rejected, findings.
- **Transcript replay** (F9) runs in CI with model outputs fixed.
- **Multi-turn eval set.** Thirty scripted sessions of 5 to 12 turns over the sample
  projects, each with an expected end state. Scored on: task success, op
  acceptance rate, **drift** (objects changed that no turn named), and rule
  findings introduced. Reported per provider and effort. A change that raises drift
  does not ship.
- **Cache hit rate and cost per turn** trended per release.

---

## 4 · Where the code goes

| Module | New or changed | Responsibility |
|---|---|---|
| `lib/ai/provider.ts` | new | the seam: `route`, `propose`, `repair`, `lookupTools`; Claude, Bedrock, Foundry, on-prem, none |
| `lib/ai/context.ts` | new | `buildContext` layers, budgets, hashing, breakpoints |
| `lib/ai/ops.ts` | changed | handles, slots, `extend`, `replaceEquipment`, `startOver`; coordinates only on explicit `moveObject` |
| `lib/ai/converse.ts` | changed | becomes the orchestrator (§3.3); no prompt string assembly here |
| `lib/ai/applier.ts` | new (from `components/chat/applyOps.ts`) | pure, runs on a draft, returns outcome + diff; exact resolution only |
| `lib/ote/layout.ts` | changed | regions, cells, slot resolution, reconcile with overrides |
| `lib/ote/place.ts` | mostly deleted | `clampToPanel` stays for explicit moves |
| `store/log.ts` | new | op log, handles, batch undo, turn records |
| `store/project.ts` | changed | projection of the log; `remember` batch mode in the interim |
| `lib/validation/quick.ts` | new | the synchronous tier |
| `workers/rules.worker.ts` | new | the full packs |
| `components/chat/Proposal.tsx` | new | ghosted diff, accept / partial / reject |
| `components/chat/useChat.ts` | changed | drives the orchestrator; sends outcomes, not prose |
| `tests/transcripts/` | new | replay fixtures and the invariants |
| `tests/context.test.ts` | new | layer budgets and cache stability |

---

## 5 · Definition of done for "the conversation is trustworthy"

1. Ten recorded sessions of at least eight turns replay with zero invariant
   violations: nothing outside the panel, no content overlap, no duplicate names,
   no dangling bindings, no unrequested moves.
2. On the 1,248-tag sample, a twelve-turn scripted session ends in the expected
   state with drift = 0 on `claude-opus-5` at `medium`.
3. Turn two on an unchanged project reads at least 70% of its input from cache.
4. Every turn is one undo step, and a turn with any rejected op changes nothing
   until the engineer accepts the repaired proposal.
5. The provider in use is chosen by configuration, named in the UI, and never
   inferred from which key happens to be present.
