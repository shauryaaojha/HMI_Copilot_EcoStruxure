# Toward autonomy, and how HMI Copilot makes money

Written 2026-11-11. Every number is either cited (sources at the end) or marked **assumption**. Exchange rate used: **1 USD = ₹93.7** (Trading Economics, 11 Nov 2026).

## 1. Where the connector stands today

Read from production on 2026-11-11 (`npm run db -- rejections`): 59 proposals, 195 refused ops.

| Refusal | Count | Cause | Status |
|---|---|---|---|
| "no screen called Home" / "No object called X" | ~171 | A second call built on a screen still waiting as a proposal | **Fixed**: proposals now stack on the open queue (`dependsOn`) |
| ToggleSwitch used as a button | 10 | OTE rule: only a Switch acts on a touch | Taught in the guide (objects topic) |
| Rounded corners on a Switch | 4 | Only a Rectangle has CornerRadius | Taught in the guide, with the pattern |
| Bind with no or unknown tag | 3 | Tag name guessed | `match_tags` (sure / ambiguous / none) |
| AlarmSummary colour, StringDisplay on INT, empty setText | 5 | OTE rules | Taught in the guide |
| NavBar "no room" | 2 | Hand-made objects already in the nav strip | Taught in the guide |

Five more proposals were "remove duplicates" clean-ups: a screen sent twice and accepted twice. `replace_screen` makes that deterministic.

The answer to "is MCP good and our system weak, or is it hallucinating?": mostly the first. Claude's ops were sensible; the system refused work that only failed because of queue ordering, and the rules OTE enforces were taught only after a refusal. Real hallucination appeared in 3 of 195 refusals (guessed tag names).

## 2. The road to autonomy

Full autonomy, meaning no human sees the HMI before it reaches a panel, is not the goal. An HMI is what an operator reads during an upset. The goal is that **the only human step left is sign-off**, and that sign-off is fast because everything before it was checked by machines.

| Level | What the agent does alone | What has to exist | Status |
|---|---|---|---|
| L1 Assisted | Proposes; a person accepts each change | Proposals, guide, deterministic tools | **Built** (this branch) |
| L2 Self-checking | Validates, renders, re-tries until its own checks pass | validate, render_screen, chat tool loop | Built, but needs a paid model key (free tier: 20 calls a day) |
| L3 Verified in the product | Opens, builds and simulates its file in licensed OTE and reads the result | A Windows runner with OTE (the laptop bench exists) that the agent can call, and a way to read OTE's Errors pane (not possible today) | Not built |
| L4 Grounded in the plant | Reads the source of truth itself: PLC program types (Control Expert `.xvm` carries DDTs), I/O lists, P&ID drawings | DDT parser into equipment classes; vision on P&IDs into a plant brief, as a proposal only | Partly (tag parsers exist) |
| L5 Policy-gated | Accepts its own changes inside a policy: validate clean, OTE bench passes, no deletes, no customer file touched, every binding `sure`; anything else waits for a person | Auto-accept policy per project, sign-off report, regression set of golden projects | Not built |

What each step needs, in build order:
1. **A paid model key** (Claude or paid Gemini). Without it L2 cannot run in front of a customer. Cost per job is in section 3.
2. **An eval set**: 10 to 20 real projects (Panel-1, the samples) with expected screens and bindings, run on every change. Nothing is autonomous that cannot be measured.
3. **The OTE runner** (L3): the UI-automation bench, made callable as a job, on a Windows machine with a licence. It is the only way to prove "opens and simulates" without a person.
4. **Sign-off workflow**: a named engineer approves a revision for export, and the report lists every AI change and who accepted it. The data is already logged.
5. **Auto-accept policy** (L5) only after 2 to 4 have run for months with their results recorded.

## 3. Money, in rupees

### What the work costs today

| Fact | Value | Source |
|---|---|---|
| HMI screen effort | 1-4 h simple, 4-8 h complex, 6-10 h SCADA graphics; 15-25% added for iterations | industrialmonitordirect.com estimation guides (vendor blogs, not studies) |
| Industrial automation engineer with HMI skills, India | ₹3.93 lakh/yr average base; ₹1.55-8.15 lakh (10th-90th pct) | PayScale |
| PLC/SCADA engineer, India | ₹1.5-6.3 lakh/yr; SCADA at Tata Power ₹9-17 lakh | AmbitionBox |
| Freelance PLC/HMI day rates, India | ₹2,500-12,500/day asked (IndiaMART listings); Freelancer.com bids around ₹13,526 per job | IndiaMART, Freelancer.com |
| India HMI market, 2025 | USD 183 million (≈ ₹1,715 crore); HMI software USD 250.64 million (≈ ₹2,348 crore) | MarkNtel Advisors / The Report Cubes; Cognitive Market Research (paid reports, scopes differ) |
| Automation system integrators in India | 190 to ~4,270 depending on the directory's definition | automa.net, revenuebase.ai |
| Competitors' AI pricing | Siemens Industrial Copilot: quote-only subscription, no public price. Rockwell FactoryTalk Design Studio Copilot: SaaS, no public price | Siemens press release and a third-party review; Rockwell product pages |

### Worked example (screen work only)

A six-screen machine HMI, like the Water_Dispenser project the connector built:
- Effort at the cited 4 h per screen midpoint, plus 20% for iterations: 6 × 4 × 1.2 ≈ **29 hours**.
- At freelance rates of ₹5,000-12,500 per 8-hour day: **₹18,000-45,000** of screen work.
- At an employee's base pay of ₹3.93 lakh/yr over **2,000 working hours (assumption)**: about ₹200/hour, so about **₹5,800** in salary. Billed to the end customer, it is the day rate that counts.

### What a job costs us

From the agent's measured run (docs/AGENT_WORKSPACE.md): 20 steps, about 190k input tokens of which 107k cached, 0.7k output.

| Model | Price (per 1M tokens) | Cost of that run |
|---|---|---|
| Gemini 3.8 Flash, standard from 1 Jan 2027 | $1.50 in / $7.50 out | ≈ $0.29 ≈ **₹27** (cache discount not counted) |
| Claude Opus 5.5 | $4 in / $20 out, cache reads $0.20 | 83k × $4 + 107k × $0.20 + 0.7k × $20 ≈ $0.37 ≈ **₹34** |

**Assumption:** a six-screen project takes 10 to 30 such runs with retries, so **₹300-1,000 of model cost per project**. Hosting stays on free tiers at today's volume (Vercel Hobby, Atlas M0, Supabase Free); paid tiers become necessary at scale and are not costed here.

### Pricing options (proposals, not market facts)

1. **Per seat**, sold to system integrators: ₹3,500 per seat per month (the figure from the original deck). It pays back when it saves the integrator **2.2 to 5.6 billable hours a month** at the cited ₹625-1,560 per hour (₹5,000-12,500 per day ÷ 8). One six-screen job is about 29 hours of screen work.
2. **Per project**: ₹2,000-5,000 per exported project. That is 4-28% of the ₹18,000-45,000 the screen work bills for, against our ₹300-1,000 model cost.
3. **Through Schneider**: bundled with OTE licences or offered to Alliance and EcoXpert partners. This is the route that avoids the licensing question below, and it is the one to raise with the Schneider team.

### Revenue scenarios (assumptions, labelled)

Per-seat model at ₹3,500 per month:

| Scenario | Integrators | Seats each | Annual revenue |
|---|---|---|---|
| Pilot | 20 | 2 | 20 × 2 × 3,500 × 12 = **₹16.8 lakh** |
| Base | 100 | 3 | **₹1.26 crore** |
| Optimistic | 500 | 3 | **₹6.3 crore** |

For scale, the base case is about 0.05% of the cited India HMI software market (₹2,348 crore). The integrator counts sit inside the 190-4,270 range the directories give; none of these is a forecast.

### What could break the model

- **Licensing**: export uses a skeleton extracted from a licensed OTE install. A hosted service handing out .eote files built on Schneider's files needs Schneider's agreement. That is the strongest reason to partner rather than sell around them.
- **Free-tier quota**: the live chat cannot be demoed or sold on 20 calls a day.
- **Version gap**: labs run OTE 4.1; our exports are 4.4.
- **Competitors**: Siemens and Rockwell ship copilots inside their own tools. Our edge is that we work at Schneider's file boundary today, with no change to their product.

## Sources

- Exchange rate: [Trading Economics, USD/INR](https://tradingeconomics.com/india/currency)
- Screen hours: [HMI development hours estimation guide](https://industrialmonitordirect.com/blogs/knowledgebase/hmi-development-hours-estimation-guide-for-tia-portal-wincc), [PLC programming estimation: hours per I/O, HMI, SCADA](https://industrialmonitordirect.com/blogs/knowledgebase/plc-programming-estimation-hours-per-io-hmi-scada)
- Salaries: [PayScale, industrial automation engineer with HMI skills, India](https://payscale.com/research/IN/Job=Industrial_Automation_Engineer/Salary/42a98d06/Human-Machine-Interface-HMI), [AmbitionBox, PLC and SCADA engineer](https://ambitionbox.com/profile/plc-and-scada-engineer-salary?page=8), [AmbitionBox, Tata Power SCADA engineer](https://www.ambitionbox.com/salaries/tata-power-salaries/scada-engineer)
- Day rates: [IndiaMART ₹12,500/day](https://www.indiamart.com/proddetail/siemens-plc-programmer-freelancer-service-2850441143255.html), [IndiaMART ₹3,000/day](https://www.indiamart.com/proddetail/plc-scada-hmi-programming-services-11924493473.html), [Freelancer.com PLC & HMI job](https://www.freelancer.com/projects/plc/plc-hmi-programming-for-hydraulic)
- Market size: [MarkNtel Advisors, India HMI](https://www.marknteladvisors.com/research-library/india-human-machine-interface-market.html), [The Report Cubes, India HMI](https://www.thereportcubes.com/report-store/human-machine-interface-market-india), [Cognitive Market Research, HMI software](https://www.cognitivemarketresearch.com/hmi-software-market-report)
- Integrator counts: [revenuebase.ai](https://revenuebase.ai/companies/browse/industrial-automation-system-integrators), [automa.net](https://automa.net/business-directory/india/system-integrator)
- Competitors: [Siemens Industrial Copilot press release](https://press.siemens.com/global/en/pressrelease/siemens-xcelerator-scaling-roll-out-generative-ai-siemens-industrial-copilot), [Siemens Industrial Copilot review](https://www.francisokafor.com/tools/siemens-industrial-copilot), [Rockwell FactoryTalk Design Studio](https://www.rockwellautomation.com/en-se/products/software/factorytalk/design-studio.html), [OEM Magazine on Design Studio Copilot](https://www.oemmagazine.org/engineering/automation/article/22927841/rockwell-automations-factorytalk-design-studio-adds-generative-ai-copilot)
- Model prices: [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- OTE licences (no INR list price was found): [Schneider India FAQ on licence types](https://www.se.com/in/en/faqs/FAQ000219759/)
