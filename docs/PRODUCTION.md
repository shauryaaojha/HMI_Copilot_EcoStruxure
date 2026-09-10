# From hackathon to production

What it would take for a plant engineer to use this on real work, in order, with
the things that gate everything else first.

This is written against the repo as it stands: a working generate → watch →
validate → export loop, 192 tests, and an `.eote` that opens in EcoStruxure
Operator Terminal Expert 4.4. That loop is real. Most of what follows is not
about making it better — it is about the difference between a loop that works
and a tool someone is allowed to use.

---

## 1. The decision that comes before the architecture

Every `.eote` this product writes contains **Schneider's own database files,
copied through verbatim** — `Recipe.db`, `Security.db`, `Language.db`,
`DriverConfig.db` and the rest. `web/src/lib/ote/skeleton.ts` reads them from a
directory that `.gitignore` deliberately excludes, and every developer extracts
their own copy from their own licensed installation.

That is the right posture for a hackathon. It is not a posture a product can
ship in, because **a hosted service needs the skeleton on the server, and a
server holding those files is redistributing them.** The same applies to the 475
graphic objects in the symbol library.

So this is not a legal review to schedule later. It picks the architecture:

| | How it works | Cost | Verdict |
|---|---|---|---|
| **A. Local generation** | The engineer runs it on a machine that already has a licensed OTE install. The skeleton never moves. | Desktop packaging, update channel, no server-side model calls unless allowed | **Build this** |
| **B. Server plans, browser packages** | Layout and inference server-side; the final `.eote` is assembled in the browser from a skeleton read off the engineer's own disk. | File System Access API is Chromium-only and fragile; complex seam | Don't |
| **C. Schneider blesses it** | An OEM agreement covering a redistributable skeleton, or — far better — an official project API. | A conversation, not code | **Pitch this** |

**Recommendation: build for A, pitch for C.** They are compatible. The packager
already takes an injectable skeleton source (`loadSkeleton(dir?)`), so the seam
exists; what changes is the shell around it, not the format layer.

A is also the honest fit for the customer. Plant engineering happens on
restricted and frequently air-gapped networks, and a cloud tool that phones a
model API is a procurement fight at every site.

**How far the offline story actually goes has narrowed, and it is worth being
exact about it.** Generation still runs with no model key — inference falls back
to parsing tag names, and the timeline says so rather than implying a model was
involved. But the primary interaction is now a conversation, and `/api/chat`
answers *"No model key is configured, so I cannot read a request in words."*
So without a model an engineer gets a one-shot generator, not the product.

That makes a **local or self-hosted model a requirement for air-gapped sites,
not a nice-to-have** — and it should be designed for now, while the provider
seam is still one module (`lib/ai/converse.ts`, `lib/ai/pipeline.ts`) with
Gemini and Claude already behind it. Adding a third path that points at an
on-prem endpoint is cheap today and expensive once the call sites spread.

---

## 2. What is already production-grade

Worth being precise about, because it is the part not to disturb.

- **The format layer and its proof.** `tests/packager.test.ts` structurally
  diffs the TypeScript packager against the Python reference — same entries,
  same binding graph, same rows. Two independent implementations agreeing is a
  much stronger claim than either one passing its own tests.
- **The one rule, enforced by the compiler.** `ScreenRenderer` switches
  exhaustively over the part union, so the canvas cannot draw what the packager
  cannot emit. `tests/canvas.test.ts` holds the other half by restating the
  Python renderer's rules rather than importing them.
- **Corrections are reported, never applied silently.** The single most
  trust-relevant behaviour in the product.
- **Findings carry an `objectId`.** Which is why the binding map and the
  validation list cannot disagree — they read the same array.

---

## 3. The four things that stop an engineer using this tomorrow

Not polish. Each one is a reason the tool gets closed and not reopened.

### 3.1 It can only write, never read

There is no `.eote` reader anywhere in `web/`. The product can create a project
and cannot open one.

**Most HMI work is brownfield.** An engineer is far more often adding a pump to
a station built in 2019 than starting a screen from nothing. Today that engineer
has no way in.

This is the largest single piece of remaining work and it is harder than the
writer, because of a property the writer never needed:

> **Round-trip safety.** Import a project, change one screen, export it, and
> everything you did not understand must come back byte-identical.

That means the reader has to keep what it cannot model, not drop it. Get this
wrong once, in a way that silently discards a recipe table or a security
configuration, and the product is finished — nobody gives it a second project.
Build it as a preservation problem first and a parsing problem second: read the
whole ZIP, model the parts you understand, carry the rest through untouched, and
have a test that asserts an unmodified round trip is byte-identical.

### 3.2 Nothing survives a closed tab

The store is Zustand in memory; the project list is `localStorage`. There is no
server-side persistence, no autosave to anywhere durable, no recovery. A day's
work ends with a browser crash.

For architecture A this is a local database and a file on disk, not a backend.
Do not build a multi-tenant service to solve it.

### 3.3 One screen

`CanvasPane` renders `screens[0]`. Real projects are 12 to 60 screens with a
navigation model between them — an overview, a screen per area, alarm and trend
screens, and the buttons that move between them. A 1,248-tag plant is not one
screen; it is a screen hierarchy, and inferring that hierarchy from tag
structure is the interesting version of the problem this product already solves
for a single screen.

### 3.4 Nothing talks to a PLC

Generated variables are internal, which is what makes the demo hardware-free.
It also means the exported project cannot read a single real value.
`DriverConfig.db` comes through from the skeleton untouched. Until an engineer
can point the generated tags at an actual device, the export is a drawing, not a
project — they will still redo the tag binding by hand, which is most of the
time the product claims to save.

---

## 4. The safety position, and why it is a feature

An HMI is what an operator looks at during an upset. A binding that points at
pump 2's flow under pump 1's label is not a rendering bug; it is the sort of
thing that shows up in an incident report.

Two consequences.

**Never move to auto-deploy.** The current design — the engineer watches every
object appear and approves before export — is not a hackathon limitation to grow
out of. It is the product's licence to exist, and it should be hardened rather
than smoothed away. No "apply directly to panel" feature, ever.

**Traceability has to be built in, not added.** For a generated project to be
defensible, the record must show: which tag export, which model and version,
which prompt, which rules passed, who approved it, when. Today `snapshot()` in
the store keeps twenty in-memory versions. That is the seed; production needs it
durable, exportable, and attached to the `.eote`.

The HTML sign-off report FORMAT built for Phase 7 is exactly the right instinct —
standalone, no external assets, because a commissioning laptop has no internet.
Extend it into the audit record.

---

## 5. Correctness you can prove

The generation quality is currently unmeasured. There is no eval harness — no
corpus, no scoring, no regression gate. For a product whose failure mode is an
operator reading the wrong number, "it looked right in the demo" is not a
standard.

**Build a golden corpus.** Twenty to fifty real tag exports across pump
stations, motor lines, batch, water treatment. For each: the screens an
experienced engineer would draw and the bindings they would make. Then score
every change to the prompt, the model or the inference against it — binding
accuracy, equipment recall, layout sanity. Ship nothing that regresses binding
accuracy.

**Extend validation to the standards engineers are actually held to.** Seven
rules today: naming, binding, type-mismatch, completeness, alarm, unused-tag,
standards. The real targets are **ISA-101** (HMI design — colour use, hierarchy,
situational awareness) and **ISA-18.2 / IEC 62682** (alarm management — priority
distribution, rationalisation, no alarm without a defined operator response).
An alarm-flood check alone would justify the tool to a lot of plants.

**Pin the format to a version matrix.** Everything here is verified against OTE
4.4 and nothing else. The packager should detect the target version and refuse
to write a format it has not been proven against, rather than produce a file
that opens wrong. Run the conformance suite against each release.

---

## 6. Sequence

Rough shape, assuming architecture A.

**First — decide and de-risk.** Take the licensing question to Schneider before
building further; the answer changes what gets built. In parallel, start the
reader (§3.1) as a preservation problem, and stand up the golden corpus (§5).
Nothing else matters as much as these three.

**Then — make it keepable.** Durable local persistence, project lifecycle,
multi-screen with a navigation model, and the audit trail made permanent. This
is the point at which an engineer can do a real day's work in it.

**Then — make it defensible.** ISA-101 and ISA-18.2 rules, the version matrix
and conformance runs, device driver configuration, and the sign-off report as a
genuine record.

**Then — make it fit the environment.** Desktop packaging and an update channel,
air-gapped install, BYO or local model, and site-level standards so a company's
own colour and naming conventions load as data rather than as code.

---

## 7. What to cut

Being clear about this is worth as much as the roadmap.

- **Multi-tenancy, SSO, an org model.** Architecture A does not need them, and
  building them commits you to a hosted service before the licensing question is
  answered.
- **A component marketplace, template sharing, anything social.** Nobody adopts
  an engineering tool for its community.
- **Real-time collaboration.** Two engineers do not edit one HMI screen at once;
  they own different screens and merge in the plant's version control.
- **Chasing more part types for their own sake.** Six of the fifty are enough for
  a pump station. Breadth matters far less than the round trip being safe.

---

## 8. The one-line version

The loop works and the format layer is genuinely defensible. What stands between
this and an engineer using it is not features — it is **the licensing question,
a reader that never loses what it does not understand, and a way to prove the
generation is right.** Everything else is sequencing.
