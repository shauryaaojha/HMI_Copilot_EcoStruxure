# Phase 4: quality without a model budget

*The credit request was declined. This is the re-plan — how the tool reaches
reference quality with a model budget of zero, and where a model still earns
its place. 27 September 2026.*

`ARCHITECTURE_SCREEN_QUALITY.md` set the target and put agents where judgement
is. `AFTER_SCHNEIDER.md` is the ledger up to now. This supersedes that
document's §5 phase order.

---

## 0 · What actually changed

We asked for API credits to run a four-arm model comparison. The answer was no.

**The goal does not change.** Screens at the level of the real ones, an
application an OTE engineer would have built by hand. What changes is where
the quality comes from, and the honest reading of the refusal is that we had
started to lean on a model for something a model was never the cheapest way to
get.

Look at the four defects the vision critic found last week:

| What the critic said | What it actually was |
|---|---|
| "The symbols are nearly invisible against the background" | A stroke width scaled down by the path transform. **A number.** |
| "This pump is labelled with a level reading" | A headline rule that ignored the equipment class. **A table lookup.** |
| "The label overlaps the value box" | Two rectangles intersecting. **Arithmetic.** |
| "Two tags are not recognised" | A suffix missing from a map. **A coverage check.** |

Not one of them needed a vision model. They needed **someone to look**, and a
model was the cheapest way to get a look at the time. Every one is detectable
from geometry we already have, for nothing, on every commit, forever.

That is the whole of this plan: **turn looking into arithmetic.**

---

## 1 · The rule: three lanes

Every quality mechanism in the tool goes in exactly one lane, and the lane is
stated in the code.

**Lane 1 — free, always, on the critical path.** Deterministic. No key, no
network, no rate limit. Runs on every commit and in every build. This is where
the pack lint lives, and where the geometric critic (§3) now lives. *Anything
that decides whether a build is good belongs here.*

**Lane 2 — free, sometimes, off the critical path.** A model, on the smallest
free tier, triggered by the engineer, one screen at a time, with every answer
cached to disk and every session recorded as a replayable transcript. A build
never waits for it; CI never calls it. *This is where judgement that genuinely
needs a model lives, and it is a luxury, not a dependency.*

**Lane 3 — never.** Anything that would put a paid call in a loop: a model in
CI, a model per screen per build, a two-pass critic that re-renders and
re-asks, a model doing geometry.

The architecture already pointed this way — the deterministic path was always
the default and the pipeline always ran keyless. The refusal just removed the
temptation to drift.

---

## 2 · What we lose, stated

Being straight about it, because the plan is weaker in exactly one place.

- **We cannot answer "does a frontier model do this better".** That question is
  parked. Not wrong, not answerable now.
- **Taste that no rule expresses** — "this screen is technically correct and
  still feels wrong" — is the one thing only a model or a person gives us. Lane
  2 keeps a thin version of it; the honest substitute is §5, measuring real
  screens and matching their numbers.
- **The critic's second pass** (re-render after accepted changes, ask again) is
  cancelled. It was three calls per screen and it is the clearest Lane 3 item in
  the old plan.

Everything else in the old roadmap survives, and two items get *better* without
a budget, because a deterministic check runs on all eight sample plants on every
commit where a model ran on one screen when we remembered to ask it.

---

## 3 · Phase 4 · The geometric critic

The critic's findings, as arithmetic over the compiled screen and the raster we
already render. One module, one rule per defect class, each one traceable to a
real defect we have actually shipped.

| Rule | Catches | How |
|---|---|---|
| `geom.overlap` | The indicator-label defect | Two non-container boxes intersecting by more than a tolerance |
| `geom.strokeInvisible` | The invisible-symbol defect | A path whose stroke width, after its transform, is under one device pixel |
| `geom.contrast` | Anything unreadable | Contrast ratio of every drawn fill and stroke against what is behind it, below a floor |
| `geom.orphanLabel` | Labels read as belonging to a neighbour | A text object whose nearest non-text object is further than its distance to a *second* object |
| `geom.alignment` | Sloppiness | Objects within a few pixels of a shared edge without sharing it |
| `geom.balance` | The dense corner and the empty half | Ink density per quadrant, against the variance the pack allows |
| `geom.crowding` | A screen that is a wall | Largest empty rectangle against the densest region |
| `model.roleCoverage` | The unrecognised-suffix defect | A wired tag whose suffix matched no role |
| `model.classHeadline` | The pump labelled "level" | A headline reading whose role is not in its equipment class's list |
| `nav.reachable` | A screen nobody can open | Every screen reachable from home through the navigation |

Each finding carries the object id, like the pack lint, so the Validation page
puts the engineer in front of it. Each gets a test that builds the defect on
purpose and proves the rule fires — including the four real ones, as
regressions.

**Done when** the four defects the model found are caught by arithmetic on
every commit, and the eight sample plants report a geometric score with no key
present.

### Built, 27 September 2026

`lib/critic/geometry.ts` and `lib/critic/coverage.ts`, both called from
`validateProject`, so they are on the critical path rather than beside it.
`tests/geometry.test.ts` builds each defect on purpose, holds the four real ones
as regressions, and then reviews every screen of all eight sample plants. 48
cases; 681 across the suite.

**What the first run found in our own output, all now fixed:**

| Found | It was |
|---|---|
| **446 overlaps** | One bug. The horizontal analogue indicator pinned its rows to both edges of its box, so at the 56–64px heights the compiler actually gives it, the scale, the band, the value and the label drew on top of each other. Shipped on every screen with a reading on it. It now lays out from the box it is given and gives up the band, then the scale — the way the screen compiler gives up callouts. |
| **28 unrecognised tag suffixes** | `_OPEN`, `_CLOSED`, `_AVAIL`, `_READY`, `_HEALTHY`, `_ESTOP`, `_JAM`, `_LOCKOUT`, `_FLAME`, `_OCC`, `_ACTIVE`, `_MODE`, `_STEP`, `_COUNT`, `_REJECT`, `_TOTALISER`, `_RATE`, `_OEE`, `_FREQUENCY`, `_KW`, `_FACTOR`, `_MOD`, `_ID`, `_CIRCUIT`, `_LEAD` — every one read as a plain value. And `_PRESSURE` and `_TEMPERATURE`, which the existing patterns missed because they only matched `_PRESS` and `_TEMP`. 24 roles added, with their units and ranges. |
| **26 headline mismatches** | 18 of them one thing: a bare `_PV` read as the generic "value". What a process variable measures is a property of the class — a valve's PV is its position, a tank's is its level — so that knowledge moved into `lib/plant/classes.ts`, where the model, the architect and the critic all read it. Down to 6, every one a genuine fallback (a heater whose only reading is an hours counter), which is what `info` severity is for. |
| **112 near-miss alignments** | Nothing. The rule was wrong: it compared box tops on text, and text on a shared row is aligned by its baseline, so a 12pt caption beside a 13pt title sits a pixel lower **on purpose**. Narrowed to shapes. Our shapes turn out to be properly snapped. |
| **37 lopsided screens** | True, and not yet fixed. A screen with three units puts three cards in the top-left and leaves the bottom half empty. This is the single biggest reason our screens read as basic beside the reference ones, and it is what §5 is for. Kept as `info` on every screen it applies to, deliberately, as a standing reminder. |

One rule was also wrong in a way worth recording: `geom.orphanLabel` excluded
containers from the candidate set, so a composite's label could never find its
own base and every indicator label was reported as belonging to a neighbouring
lamp. It now measures against the label's own family and reports only when
another family's shape is strictly nearer.

**The honest score of the exercise:** five of the seven things the first run
reported were real, one was a bug in the critic, and one is a true finding we
have not acted on. The 446 and the 26 are both single causes seen many times,
which is exactly what a deterministic pass over a whole corpus gives you and a
model looking at one screen does not.

---

## 4 · Phase 5 · The corpus and the release gate

Schneider's own method, which costs nothing: generate, store, compare.

- `corpus/` holds the eight plants' tag files and one stored build per plant.
- `npm run corpus` rebuilds each, compares against the stored copy, and prints
  what moved. A difference nobody intended fails the run.
- A scoreboard committed with each release: per plant, the pack lint count, the
  geometric score, object and screen counts, build time.
- Project-file comparison today; the runtime-output comparison Schneider
  described drops in as a second comparator the day we learn how to produce it.

**Done when** a release prints the scoreboard and a diff, and a change that
silently alters an untouched screen cannot merge.

---

## 5 · Phase 6 · Reference-measured quality

This is the replacement for asking a model whether we look professional yet.
It is better than asking, and free.

Take the real screens — the reference set, and the sample projects in the OTE
installation — and **measure them**, the same way we measure ours:

- objects per screen, and the split between graphic and text
- distinct colours actually drawn, and how much of the screen each covers
- ink density overall and per quadrant
- font sizes used, and the ratio between the largest and the smallest
- symbol size distribution, and the whitespace between symbols
- values per screen, and labels per value

One command measures any screen and prints that vector. Run it on the
references, run it on ours, and the gap stops being an opinion. "Their screens
use four colours over 3% of the area; ours use nine over 22%" is a work item.
"Our screens look basic" is not.

**Done when** the reference profile is in the repository, our generated screens
are measured against it, and each metric's gap is a number in the scoreboard.

---

## 6 · Phase 7 · The free model lane, made honest

A model still helps. It just has to be free and off the critical path.

- **A disk cache keyed by the screen's content hash.** The same screen is never
  sent twice, so re-reviewing a project after editing one screen costs one call.
- **Every session recorded** as a replayable transcript, extending
  `scripts/record-session.mts` to the critic. A model interaction becomes a
  test that replays free forever — we already found two real faults this way.
- **A call budget per session**, refused past the limit, so a free tier is never
  blown by a loop.
- **A local endpoint.** The provider seam grows an OpenAI-compatible provider
  with a configurable base URL, so a vision model running in Ollama or LM Studio
  on the engineer's own machine is a first-class option. That is also exactly
  what an OT customer with no outbound network needs, so the work is not a
  workaround — it is the deployment shape from `REENGINEERING.md` §4.1, brought
  forward because we cannot afford the alternative.

**Done when** a review costs one call per changed screen, a local model answers
through the same seam as a hosted one, and no code path can call a model in a
loop.

---

## 7 · Phase 8 · What Schneider asked for, unchanged

Neither of these needs a model, so the refusal does not touch them. They move
up the order.

- **Native objects.** Composites emitted as real EOTE Compound Objects, the
  frame as a master screen, a customer's own library ingested and placed.
- **Format independence.** The panel as a loaded profile; the writer as an
  interface with OTE first and Vijeo Designer second.

---

## 8 · Order, and why

| # | Item | Why here | Cost |
|---|---|---|---|
| 1 | Geometric critic (§3) | Replaces the thing we just lost, and catches more than it did | zero |
| 2 | Corpus and gate (§4) | Makes every later change safe, and it is Schneider's own asked-for method | zero |
| 3 | Reference profile (§5) | Turns "looks basic" into numbered work items | zero |
| 4 | Native objects (§7) | Schneider asked for it; it is the strongest demo we do not have | zero |
| 5 | Free model lane (§6) | A luxury once the above hold; the local endpoint also unblocks the offline story | zero |
| 6 | Format independence (§7) | Wants a real Vijeo file, which we have asked for | zero |

Every row costs nothing to run. That is the point: the plan is now funded.

---

## 9 · Risks

- **Rules encode our taste, not a standard.** Mitigation: every rule traces to a
  defect we actually shipped, or to a number measured from a real screen. A rule
  we cannot justify that way does not go in.
- **Arithmetic passes and the screen still looks wrong.** True, and the reason
  Lane 2 survives at all. The reference profile in §5 is what narrows it.
- **A deterministic critic can be gamed by the generator** — we write both sides.
  Mitigation: the corpus stores output, so a rule that starts passing because
  the generator learned to dodge it shows as a diff.
- **The free tier disappears.** Then Lane 2 goes dark and Lane 1 carries the
  tool, which is the whole reason for the split.
