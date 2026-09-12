# Working with Schneider: the engagement plan

*The ninety days after the hackathon — how to arrive with a position rather than
a demo, and what to settle with Schneider before building anything more.*

`PRODUCTION.md` is the technical roadmap and it stands. This is the other half:
what the outside world looks like, who decides, what end users will actually
demand, and the order to do things in so that the first conversations with the
Schneider team are ones they remember.

---

## 1 · Where we honestly stand

Before proposing anything to anyone, the position has to be exact. It is
stronger than a hackathon entry and weaker than a product, and knowing which
parts are which is what stops us overclaiming in a room full of people who will
check.

**Real, tested, defensible**

- A PLC tag export and a sentence become an EcoStruxure Operator Terminal
  Expert 4.4 project that opens in the product — screens, variables, alarms,
  bindings. The packager writes plain JSON and SQLite, and `demo_project/` holds
  files that OTE has opened.
- 478 tests, including a fixture lifted out of a real `.eote` and a comparison
  that fails if the browser canvas and the Python renderer ever draw the same
  JSON differently. *One model, two renderers.*
- Equipment inference from ISA-5.1 tag naming, without a model, deterministic.
- An ISA-101 layout engine: hierarchy, fixed navigation zones, six units to a
  display, every unit placed.
- Import corrections **reported, never applied silently**, against the
  product's own reserved-word lists.
- A conversational editor whose every op runs through the same store actions as
  the toolbar, so a change asked for in words lands in the same undo history as
  one made with the mouse.

**Real, but a demo shape**

- Persistence is `localStorage`. There is no project lifecycle, no multi-user,
  no audit trail that survives a cleared browser.
- The model provider is a hosted API. Generation degrades gracefully without
  one; the conversation does not.
- Conversational placement after the third or fourth edit is coordinate-based
  and rough. We know why (the model is handed a flat list of boxes and asked to
  do geometry) and we know the fix (a slot vocabulary, or re-layout).

**Cannot ship as-is, by construction**

- Every `.eote` embeds Schneider's own database files, copied through from a
  skeleton extracted from a licensed install. The 474 graphic objects are
  Schneider's too. Both are gitignored and both are needed to produce output.
  **This is not a technical debt item. It is the first thing to put on the
  table.**
- It writes projects. It cannot read one. An engineer with an existing
  application gets no help with it.

That last list is the agenda for the first meeting.

---

## 2 · What the outside world looks like

Researched, with sources at the end. Four things reshape the plan.

### 2.1 Schneider's own copilot does not do HMI

Schneider launched an industrial copilot with Microsoft in May 2025, built on
Azure AI Foundry and trained on Schneider's own libraries and Lighthouse-factory
data. It lives **exclusively inside EcoStruxure Automation Expert** and today it
does code generation, unit tests, legacy code explanation, documentation, and
error checking. Its stated roadmap is an agentic system and *"expansion across
additional Schneider software tools."*

Nothing in the announcement or the Automation World interview with its lead
mentions HMI screens, visualisation, or the Harmony panel line.

**What this means:** we are not competing with Schneider's AI team. We are the
thing their roadmap says comes next, for a product line they have not reached.
The pitch is *"this is what the copilot looks like when it gets to the HMI
tools"*, and the ask is to be the people who build it.

### 2.2 OTE's place in the portfolio is narrower than we assumed

Schneider's own FAQ says OTE's focus is **basic operator panels** (HMISTO7,
HMIST6). For advanced panels like the GTU range the preferred software is
**still Vijeo Designer**, and the migration tool from Vijeo Designer to OTE
*"has been put on hold temporarily."*

**What this means:** a generator that only writes OTE files serves the low end
of the range. The format layer — schema, packager, bindings graph — is the
genuinely defensible asset, and it should be designed as an **adapter**: OTE
today, Vijeo Designer and EcoStruxure Automation Expert HMI as targets the same
inference and layout can write to. Ask Schneider which panels their customers
are actually buying before deciding which adapter comes second. This is a
question that demonstrates portfolio understanding, and it is one an intern is
allowed to ask.

### 2.3 Siemens already does an initial visualisation; Rockwell does not

Siemens' Engineering Copilot for TIA Portal creates *"an initial basic HMI
visualisation in WinCC Unified including header, navigation and settings"*,
alongside SCL code, test cases and drive configuration. Introduced July 2024,
customers scaling from 2025. Rockwell's FactoryTalk Design Studio Copilot does
ladder logic, device configuration and troubleshooting — no HMI generation yet —
and Rockwell is moving to an edge-hosted small model (NVIDIA Nemotron Nano).

**What this means:** "AI makes a screen" is table stakes. Siemens ships it. The
differentiation is specific and provable:

| Siemens Copilot | HMI Copilot |
|---|---|
| One initial screen with chrome | A whole application on the ISA-101 hierarchy, every unit placed |
| Prompt-driven | Tag-driven: equipment inferred from ISA-5.1 names, deterministically, before any model runs |
| Generates | Generates **and verifies**: import corrections reported, naming enforced against the product's reserved words, a round-trip test, a validation report |
| One shot | A conversation whose every edit is undoable and lands in the same history as a mouse edit |
| Cloud managed service | Runs with no model key; designed for a self-hosted model on an air-gapped site |

Rockwell's Nemotron move is worth quoting back to Schneider: the industry is
already moving models to the edge because OT customers will not phone a cloud.

### 2.4 The gates a production tool will be held to

- **IEC 62443-4-1**, the secure development lifecycle for IACS components:
  threat modelling, coding guidelines, verification, defect and patch
  management, end-of-life. Any tool that writes files that end up on a plant
  panel will be asked about it. Not a certification to chase now; a set of
  practices to adopt early because they are cheap to start and expensive to
  retrofit.
- **On-premise.** Enterprise surveys put genAI at six to eighteen months from
  intake to production, with governance and data handling as the common
  blockers. In OT it is stricter: tag lists describe a plant, and a plant's tag
  list does not leave the site. PRODUCTION.md already calls a self-hosted model
  path a requirement; the research says it is the *first* thing a customer's
  security team will ask.
- **Distribution.** The formal third-party route is Schneider Exchange plus the
  Technology Partner Program: products are submitted to Schneider's labs for
  testing and approval and earn a "Tested and Approved" designation. That is
  the path for an outside company. For an intern inside the HMI product line,
  the path is internal productisation — a feature, an incubation, or a plugin —
  and it is a better path, because it settles the licensing question by making
  it moot.

---

## 3 · Three questions to settle before building more

Each one changes what gets built. Take them to Schneider in this order and do
not start the roadmap in §6 until the first two have answers.

**Q1 — Licensing.** Can a redistributable skeleton be blessed, or — better — is
there or could there be an official project-creation API so nothing of
Schneider's is copied at all? This one question decides whether the product is
a desktop tool that runs beside a licensed install (architecture A in
PRODUCTION.md) or something that can be hosted. Ask it in the first meeting.
Asking it yourself, unprompted, is the single strongest signal that you
understand the difference between a demo and a product.

**Q2 — Which product.** OTE only, or OTE plus Vijeo Designer plus EAE HMI? Which
panels are customers buying? Is the OTE migration tool coming back? The answer
picks the second format adapter and tells you whether the OTE work is a
beachhead or the whole beach.

**Q3 — Where it lives.** A standalone tool, an OTE plugin, or a capability of
the existing copilot inside Automation Expert? The AI team will have a view.
The right answer for adoption is probably "inside the product the engineer
already has open", and the right answer for speed is standalone. Find out
which one they can actually staff.

---

## 4 · Who to meet, and what to bring

The hackathon is the introduction — the organisers and judges already know the
work. Use them for one thing: an introduction to the HMI product owner. From
there, in roughly this order:

| Who | What they care about | Bring | Ask |
|---|---|---|---|
| **Hackathon organisers / judges** | That the win turns into something | The repo, the deck, one sentence: "we want to build this for real with the HMI team" | An intro to the OTE / Harmony product owner |
| **HMI product owner** (OTE, Harmony, Pro-face line) | Roadmap fit, customer pull, what it does to their support load | The showcase on this machine, the beverage-plant sample, the Standards page | Q2, and: which customers would try it? |
| **OTE R&D lead / architect** | The format, what we got wrong about it, whether an API exists | `lib/ote/`, the packager tests, the round-trip fixture, the list of what we could not read | Q1, and: what does the file format look like at 5.0? |
| **The copilot / AI team** (Automation Expert, Microsoft collaboration) | Not being duplicated; a common model layer | The provider seam in `lib/ai/`, the four-mode turn design, the op vocabulary | Q3, and: can we share the model gateway and the on-prem story? |
| **Product security office** | 62443-4-1, SBOM, telemetry, what leaves the site | The no-telemetry posture, the no-key mode, a one-page threat model (write it — §6) | What is the bar for an engineering tool, as opposed to a runtime? |
| **Legal / licensing** | Redistribution of the skeleton and graphics | The exact list of Schneider files an `.eote` embeds | Q1, precisely |
| **Two field application engineers** | Whether it saves *them* a day | Nothing. Watch them work first. | §5 |
| **One system integrator, one end customer** | Time, rework, FAT defects, whether they can trust it | The pilot proposal in §5 | Would you run one real project through it? |

Meet the FAEs before the product owner if you can. What they say in the first
ten minutes will change the pitch.

---

## 5 · Discovery with end users, then a pilot

The hackathon problem statement is Schneider's framing of the pain. Before
building for end users, hear the pain from end users, in their words, at their
desks.

### 5.1 Discovery — three weeks

**Eight to ten conversations**, forty-five minutes each, with a spread of HMI
engineers: two or three Schneider FAEs, two or three at a system integrator,
two at an end customer, one who mostly maintains legacy projects. Not a survey.
Ask, listen, write down verbatims.

The questions that matter:

1. Walk me through the last screen you built. From what, how long, what did
   you copy from where?
2. What did you get wrong the first time, and how did you find out?
3. Where does the tag list come from, and how often does it change after you
   start?
4. What does your company's standard look like — a document, a template
   project, someone's head?
5. What would you never let a tool decide for you?
6. When a project comes back from site, what changed?

And one thing to **observe**, not ask: sit beside someone building a screen for
an hour. The gap between what people say they do and what they do is where the
product is.

**Output:** a one-page ranked pain list with verbatims; a definition of "done"
for a screen in their words; and the list of things that would stop them using
it, which is the real backlog.

Expect the reader (open an existing project) and the company standard (load
*our* colours and naming, not yours) to rank above anything about generation.
PRODUCTION.md predicted both. Discovery is where they get their priority from
the people who will use the thing rather than from us.

### 5.2 Pilot — one real project, measured

One system integrator and one end customer, chosen because they have a project
starting in the window and are willing to run it two ways.

**Scope.** One real project, their real tag export, their real standard. The
tool produces the first cut of every screen; their engineer finishes it. Nothing
on a live panel until it has been through their normal FAT.

**Measure, with a baseline from their last comparable project:**

| Metric | Baseline from | What we hope to see |
|---|---|---|
| Hours from tag list to first reviewable screen set | Their last project | Days become hours |
| Naming and type errors caught before FAT | Their FAT punch list | Caught at import instead |
| Rework after site handover | Their change log | Fewer binding errors, because bindings were generated not typed |
| Screens an engineer accepted without rebuilding | Count | The honest number, whatever it is |
| What they changed by hand, and why | Interview | The next backlog |

**Data handling, stated up front:** the tool runs on their machine; the tag
list never leaves it; the model is self-hosted or absent. Write this down and
give it to their security team before they ask. It will be the first thing they
ask.

**Output:** a two-page pilot report with the numbers, the verbatims, and what
we would change. This document is what turns an internship into a product
conversation, because it is evidence rather than a demo.

---

## 6 · The technical roadmap, sequenced against the engagement

PRODUCTION.md has the detail. This is the order, and what each phase unblocks.

**Phase 0 — before the first meeting (now).**
- Write the one-page threat model: what the tool reads, what it writes, what
  leaves the machine (nothing), what a malicious tag export could do to it.
- Write the exact inventory of Schneider files an `.eote` embeds. Take it to Q1.
- Decide the two-adapter shape of the format layer on paper, so Q2 has a
  diagram to answer against.
- Fix conversational placement with a slot vocabulary. It is the known weak
  spot and it will be the first thing a Schneider engineer finds. Two days.

**Phase 1 — once Q1 has an answer.**
- **The reader.** Open an existing `.eote`, preserve everything not understood
  byte-for-byte, write it back unchanged. This is the feature discovery will
  rank first, and it is what makes the tool safe to use on a real project.
- Durable local persistence and a project lifecycle. Autosave to a real store,
  named versions, an audit trail that survives the browser.
- The provider seam gets its third path: an on-prem endpoint. Build it while
  the seam is still one module.

**Phase 2 — during the pilot.**
- Company standards as data: their palette, their naming, their chrome, loaded
  from a file rather than baked into `layout.ts`.
- The validation report as a genuine FAT artefact — the thing an SI attaches
  to a handover.
- Golden corpus: every project the pilot produces, round-tripped, in CI.
- 62443-4-1 practices adopted, not certified: threat model maintained, SBOM
  generated, dependencies pinned and reviewed, a defect process.

**Phase 3 — after the pilot report.**
- The second format adapter, whichever Q2 picked.
- Packaging for the environment discovery described: desktop, air-gapped
  install, update channel.
- Whatever the pilot's "what they changed by hand" list says.

**Cut, deliberately:** hosting, tenancy, SSO, marketplace, collaboration,
anything that commits to a hosted service before Q1 is answered. PRODUCTION.md
§7 says why, and the licensing research confirms it.

---

## 7 · The first thirty days

**Week 1 — arrive with a position.**
- Send the organisers a two-paragraph note: thank you, what we want to do next,
  the one ask (an intro to the HMI product owner).
- Write the threat model and the embedded-files inventory. One page each.
- Fix slot-based placement. Ship it. Have something to say that is newer than
  the hackathon.
- Draft the discovery question list and the pilot proposal from §5.

**Week 2 — listen before pitching.**
- Meet two FAEs. Watch one build a screen.
- Rewrite the pitch from what they said.
- Meet the product owner. Ask Q2. Show the showcase, on this machine, with the
  library on.

**Week 3 — settle the hard question.**
- Meet R&D and legal together if possible. Ask Q1 with the inventory in hand.
- Meet the AI team. Ask Q3. Offer the provider seam.
- Start discovery interviews at the SI and the end customer.

**Week 4 — commit to the pilot.**
- Discovery report written.
- Pilot proposal agreed, baselines collected, security note delivered.
- Phase 1 started, with the reader first.

---

## 8 · How to show up

This is the part that decides whether the internship becomes a role.

**Bring evidence, not enthusiasm.** The repo, the test count, the `.eote` that
opens, the Standards page that reads its numbers from the code that enforces
them. Every claim in a meeting should have a file behind it.

**Lead with the gaps.** Open with §1's third list — what cannot ship and why.
Engineers trust people who know what their own thing cannot do. Nobody in that
building has ever been impressed by a demo that hid its edges; all of them have
been burned by one.

**Ask Q1 yourself.** Do not wait for legal to raise redistribution. Raising it
first says you understand the difference between a hackathon and a product,
which is the entire question they are asking about you.

**Show you read their portfolio.** Know that the copilot lives in Automation
Expert and does not do HMI. Know that OTE is the basic-panel tool and Vijeo
Designer still owns the top of the range. Know that Siemens ships an initial
visualisation. Say each of these once, in the right meeting, as a fact rather
than a flourish.

**Ship something small in the first week.** The placement fix. A new sample. A
test. A thing that exists on Monday that did not exist on Friday is worth more
than any slide.

**Take notes and send them.** After every meeting, a short note to the people
in it: what was decided, what was asked, what you will do by when. Interns who
do this get invited back to the next meeting.

---

## 9 · What not to promise

- **Not** "it replaces the engineer." It produces the first cut; the engineer
  owns the result. Say this before anyone asks.
- **Not** a live-panel demo. Nothing this generates goes on a running panel
  without their FAT. The safety position in PRODUCTION.md §4 is a feature;
  keep it.
- **Not** a cloud product, until Q1 says it can be.
- **Not** a timeline for reading Vijeo Designer projects, until Q2 says it
  matters.
- **Not** numbers we have not measured. The pilot produces the numbers. Until
  then the honest figures are the ones in the tests.

---

## Sources

- Schneider Electric industrial copilot, launch and scope: [Process Excellence Network](https://www.processexcellencenetwork.com/ai/news/schneider-electric-launches-industrial-generative-ai-copilot-with-microsoft) · [ARC Advisory Group](https://www.arcweb.com/blog/schneider-electric-launches-ai-copilot-industrial-automation-collaboration-microsoft) · [Automate 2025 press release](https://www.se.com/us/en/about-us/newsroom/news/press-releases/schneider-electric-unveils-innovations-advancing-american-manufacturing-at-automate-2025-6821e196c40a38c3120b8237/) · [Automation World interview with Aurelien LeSant](https://www.automationworld.com/process/digital-transformation/article/55305398/schneider-electric-inside-the-new-industrial-copilot-with-schneider-electrics-aurelien-lesant)
- OTE's portfolio position and the migration tool: [Schneider Electric Vijeo Designer & Harmony HMI FAQs](https://www.se.com/us/en/faqs/FAQSET0000003-vijeo-designer-harmony-hmi-faqs-schneider-electric/) · [EcoStruxure Operator Terminal Expert](https://www.se.com/us/en/product-range/62621-ecostruxure-operator-terminal-expert/)
- EcoStruxure Automation Expert and its HMI: [Control Engineering, Automate 2025](https://www.controleng.com/automate-2025-redefining-control-with-software-defined-automation/) · [se.com product range](https://www.se.com/us/en/product-range/23643079-ecostruxure-automation-expert/)
- Siemens Engineering Copilot for TIA Portal: [Siemens product page](https://www.siemens.com/en-us/products/tia-portal/engineering-copilot-tia-standard/) · [Siemens press release](https://press.siemens.com/global/en/pressrelease/siemens-xcelerator-scaling-roll-out-generative-ai-siemens-industrial-copilot) · [devicebase.net](https://devicebase.net/en/siemens-industrial-copilot-for-engineering)
- Rockwell FactoryTalk Design Studio Copilot and Nemotron: [Control Global](https://www.controlglobal.com/show-coverage/rockwell-automation-automation-fair/article/55245146/let-generative-ai-be-your-design-copilot) · [Rockwell press release](https://www.rockwellautomation.com/en-us/company/news/press-releases/rockwell-automation-to-advance-industrial-intelligence-through-e.html) · [RealPars](https://www.realpars.com/blog/factorytalk-design-studio-copilot)
- Schneider Exchange and the Technology Partner Program: [Schneider Electric Exchange](https://exchange.se.com/) · [i-SCOOP](https://www.i-scoop.eu/schneider-electric-ecoxpert/schneider-electric-exchange/) · [MIT CISR working paper](https://cisr.mit.edu/publication/MIT_CISRwp466_SchneiderElectricExchange_MockerSebastian) · [Data Centre Solutions](https://datacentre.solutions/news/27899/schneider-electric-introduces-ecostruxure-trade-alliance-and-technology-partner-programs)
- IEC 62443-4-1: [IEC webstore](https://webstore.iec.ch/en/publication/33615) · [Security Compass](https://www.securitycompass.com/blog/iso-iec-62443-4-1-and-62443-4-2/) · [ISASecure SDLA](https://isasecure.org/certification/iec-62443-sdla-certification)
- Enterprise genAI adoption and on-premise: [ModelOp 2025 AI Governance Benchmark](https://www.modelop.com/ai-gov-benchmark-report) · [IntuitionLabs on air-gapped assistants](https://intuitionlabs.ai/articles/enterprise-ai-code-assistants-air-gapped-environments)
- Schneider Electric India early careers: [careers.se.com/india](https://careers.se.com/india) · [Early Careers](https://careers.se.com/early-careers?lang=en-US)
