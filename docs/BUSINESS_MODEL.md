# Business model

**HMI Copilot — who pays, why, how much, and what stops someone else doing it.**

Written against the repo as it stands: a working generate → watch → validate → export
loop, 467 tests, and an `.eote` that opens in EcoStruxure Operator Terminal Expert 4.4.

Every figure below that is not measured from this repo is labelled as an assumption.
Nothing here is a market study; it is a model you can change the inputs of.

---

## 1. The licensing question picks the business model

This has to come first, because it decides what can be sold at all.

Every `.eote` this product writes contains **Schneider's own database files, copied
through verbatim** — `Recipe.db`, `Security.db`, `Language.db`, `DriverConfig.db`.
`web/src/lib/ote/skeleton.ts` reads them from a directory `.gitignore` deliberately
excludes, and every developer extracts their own copy from their own licensed
installation. The same applies to the 474 indexed graphic objects.

That is correct for a hackathon. It is not a posture a product can ship in: **a hosted
service needs the skeleton on the server, and a server holding those files is
redistributing them.**

| | How it works | Cost | Verdict |
|---|---|---|---|
| **A. Local generation** | Runs on a machine that already has a licensed OTE install. The skeleton never moves. | Desktop packaging, an update channel | **Build this** |
| **B. Server plans, browser packages** | Layout and inference server-side; the `.eote` assembled in the browser from a skeleton on the engineer's own disk. | File System Access API is Chromium-only and fragile | Don't |
| **C. Schneider blesses it** | An OEM agreement covering a redistributable skeleton, or better, an official project API. | A conversation, not code | **Pitch this** |

**Build for A, pitch for C.** They are compatible — the packager already takes an
injectable skeleton source (`loadSkeleton(dir?)`), so the seam exists.

A is also the honest fit for the customer. Plant engineering happens on restricted and
frequently air-gapped networks, and a cloud tool that phones a model API is a
procurement fight at every site.

**Consequence for the model:** this is sold as a **licensed desktop tool, per engineer
seat** — not as a SaaS. That sidesteps redistribution entirely, because the skeleton
never leaves the machine that is already licensed to have it.

---

## 2. Who pays

| Buyer | What they feel | Why they buy | Priority |
|---|---|---|---|
| **System integrators and panel builders** | Fixed-price projects, margin pressure, HMI engineering is a large share of the hours. | Time saved converts directly into margin on work they have already quoted. They buy tools with their own money and decide fast. | **The wedge** |
| **End users — plants, utilities, OEMs** | Inconsistency across contractors, standards drift, errors found at commissioning. | They own the house style. Standards packs make every contractor produce *their* HMI, not the contractor's. | Expand |
| **Schneider Electric** | OTE competes with Siemens WinCC and Rockwell FactoryTalk on engineering productivity. | A generative front end that runs on the format they already ship, with no change to the product. | Scale |

**Start with integrators.** Sharpest pain, shortest sales cycle, and they already have a
licensed OTE installation on every engineering laptop — which is exactly what
architecture A requires. The customer and the technical precondition are the same people.

---

## 3. Where the value is

We will not quote a percentage saving we have not measured. Here is what the tool
actually did on one measured run, and the arithmetic is the reader's.

| What the tool did, measured | The manual equivalent |
|---|---|
| 560 objects placed across 11 screens | Hand-placing 560 objects: select part, position, size, name, repeat |
| Every tag binding resolved | Opening a property sheet once per binding and typing a tag name into it |
| 232 alarms configured with triggers | Creating 232 alarm rows and wiring each to its trigger tag |
| 1,248 tags ingested, 5 names corrected and reported | Reading an export and finding the five names OTE will silently drop |
| 0 errors, 0 warnings at design time | Finding those errors at commissioning instead, on site |

**Honest framing:** we compress the *first draft* and the *binding pass*. Review,
refinement and sign-off stay with the engineer — deliberately, because that is the
product's licence to exist (§7).

**On reproducibility:** screens and objects vary with the model. Runs of the same prompt
over the same 1,248-tag export produced 8/434, 10/486 and 11/560. What did **not** vary
on any run: 232 alarms, 1,248 tags, 5 corrections, 47 units inferred, every binding
resolved, 0 errors. Quote the second set; label the first as one run.

---

## 4. Packaging and price

| Tier | Who | Includes | Price |
|---|---|---|---|
| **Individual** | One engineer, one laptop | Local generation, all part types, symbol library, validation, export, sign-off report | €149 / engineer / month, billed annually |
| **Team** | 5–25 seats at an integrator | Everything above, plus shared standards packs, project templates, priority support | €119 / seat / month |
| **Site / Enterprise** | A plant or a large integrator | On-prem or air-gapped install, bring-your-own or local model, audit trail export, custom standards packs authored to house style, version-matrix conformance, SLA | from €40k / year |
| **OEM** | Schneider Electric | Bundled with or sold alongside OTE; revenue share or per-licence royalty | Negotiated |

Illustrative pricing. The anchor is a fully-loaded automation engineer's cost; the tool
should cost a small fraction of the hours it gives back.

**Priced per engineer, not per project or per screen.** Per-screen pricing would punish
exactly the customer we want — the one generating a whole plant.

### Break-even

```
ASSUMPTIONS  (state them, let the customer change them)

  Fully-loaded automation engineer          EUR  70 - 100 / hour
  Seat price, Team tier                     EUR 119 / month  =  EUR 1,428 / year

BREAK-EVEN

  Hours the seat must give back per year    1,428 / 85  =  ~17 hours
  That is about two working days.

THE QUESTION FOR THE CUSTOMER

  Across a year of projects, does generating the first draft of your screens
  and resolving your tag bindings save you two days?
```

Break-even at roughly two days a year is an easy question to answer honestly, and it
does not depend on a savings claim we cannot defend. A single 1,248-tag plant
generation is several hundred objects and every binding. The argument is not close.

---

## 5. Go to market

| | Land | Expand | Scale |
|---|---|---|---|
| **Who** | System integrators, 5–50 engineers | Their end customers — plants and utilities | Schneider's channel |
| **Motion** | Direct, self-serve trial on a laptop that already has OTE | Standards packs authored to the customer's house style | OEM agreement, bundled with OTE |
| **Proof needed** | A generated project opens. Already true. | Round-trip safety on brownfield projects, and the audit trail | Version-matrix conformance across OTE releases |
| **Why they move** | Margin on fixed-price work | Every contractor produces their HMI, not the contractor's | Engineering productivity as a competitive answer to WinCC and FactoryTalk |

The sequencing is **forced by the licensing question, not chosen**. Until Schneider
blesses a redistributable skeleton, the product runs where a licence already is — which
happens to be exactly where the buyer already is.

---

## 6. The moat

1. **Format knowledge that had to be earned.** Fifty real part types extracted from
   shipped projects, the machine-readable property definitions, the palette resolved out
   of the product's own `Colors.lua`, the naming and reserved-word rules, and the
   backslash entry separator that decides whether a file opens at all. None of this is
   documented publicly. All of it is verified by a file that opens.

2. **Two implementations that agree.** A Python reference and a TypeScript packager,
   structurally diffed against each other in the test suite. Anyone can write one
   packager. Proving it correct is the work.

3. **The compiler-enforced rule.** The canvas cannot render what the packager cannot
   emit. A competitor who builds a pretty preview separately from the generator will
   ship drift, and their customers will find it.

4. **Standards packs become switching cost.** Once a customer's naming, colour and
   layout conventions live in the tool as data, and every contractor generates against
   them, leaving means renegotiating consistency across a supply chain.

5. **The golden corpus compounds.** Twenty to fifty real tag exports with the screens an
   experienced engineer would draw is a dataset that gets more valuable every time the
   model or the prompt changes. It is also the only thing that lets us say "we did not
   regress."

---

## 7. The safety position, and why it is commercial

An HMI is what an operator looks at during an upset. A binding that points at pump 2's
flow under pump 1's label is not a rendering bug; it is the sort of thing that appears
in an incident report.

**Never move to auto-deploy.** The current design — the engineer watches every object
appear and approves before export — is not a hackathon limitation to grow out of. It is
the product's licence to exist, and it should be hardened rather than smoothed away. No
"apply directly to panel" feature, ever.

This is commercially load-bearing, not just ethically. A tool that writes HMI screens
unattended is a liability question at every procurement review. A tool that drafts and
makes an engineer sign off is a productivity purchase.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Schneider declines a redistributable skeleton** | High | Architecture A needs no redistribution — the tool runs where a licence already is. The business survives a "no". |
| **A generated binding is wrong and nobody catches it** | Critical | Never auto-deploy. The engineer approves before export, findings carry object ids, and the golden corpus gates every change to binding accuracy. |
| **Format drift across OTE versions** | Medium | Part schemas are read from the installation at run time rather than hardcoded, and `Project.dat` carries a version we check. The packager should refuse to write a version it has not been proven against. |
| **Schneider builds this themselves** | Medium | The likely outcome is an acquisition or an OEM deal, not a competitor. Being the team that already solved it is the position we want. |
| **Air-gapped sites cannot reach a model** | Medium | A local or self-hosted model is a requirement, not a nice-to-have. The provider seam is one module today (`lib/ai/`) — cheap to extend now, expensive once the call sites spread. |

---

## 9. What we would build next, in order

**First — decide and de-risk.** Take the licensing question to Schneider; the answer
changes what gets built. In parallel, start the `.eote` reader as a preservation problem,
and stand up the golden corpus. Nothing else matters as much as these three.

**Then — make it keepable.** Durable local persistence, project lifecycle, and the audit
trail made permanent. This is the point at which an engineer can do a real day's work in it.

**Then — make it defensible.** ISA-101 and ISA-18.2 / IEC 62682 rules, the version matrix
and conformance runs, device driver configuration, and the sign-off report as a genuine
record.

**Then — make it fit the environment.** Desktop packaging and an update channel,
air-gapped install, bring-your-own or local model, and site-level standards packs.

### Deliberately cut

Multi-tenancy, SSO and an org model — architecture A does not need them, and building
them commits you to a hosted service before the licensing question is answered. A
component marketplace or anything social — nobody adopts an engineering tool for its
community. Real-time collaboration — two engineers do not edit one HMI screen at once.

---

## 10. The one-line version

The loop works and the format layer is genuinely defensible. Sell it as a **per-seat
desktop tool to system integrators**, because that is the only shape that survives the
licensing question and it is where the pain is sharpest. Break-even is about two days of
an engineer's year. What stands between this and a real customer is not features — it is
the licensing conversation, a reader that never loses what it does not understand, and a
way to prove the generation is right.
