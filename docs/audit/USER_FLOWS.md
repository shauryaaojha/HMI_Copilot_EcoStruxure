# User flows, walked (audit 2026-11, stream S4)

Walked on 4 November 2026.

- **Production** (https://hmibuildtimecopilot.vercel.app): read-only. Only the landing page, `/signin` and a signed-out workspace were opened. Every request was a GET (checked in the network log). Nothing was submitted.
- **Locally** (http://localhost:3000): a production build (`next start`) with the file store. Three accounts were used:
  - the shared local test account (the owner);
  - one throwaway account made for this walk, `s4-commenter@hmicopilot.test` (the reviewer);
  - no account at all (the signed-out viewer).
- **The .eote file**: the tracked `demo_project/HMICopilot_PumpStation.eote`, uploaded to the local server only. No client project was uploaded anywhere.
- **Labels**: each step below is quoted as the screen shows it. Bug ids (S4-nn) point to `docs/audit/BUGS.md`. The failing tests are in `web/scripts/audit/s4-*.test.ts`.

The local server ran as a development build at first. It began to answer 500 on every route it had not yet compiled. The error was "Jest worker encountered 2 child process exceptions, exceeding retry limit", with the node process at 2.3 GB. The orchestrator replaced it with a production build. Everything below was walked on that build. Its error pages are the generic production ones.

---

## Flow 1. A first-time engineer with an existing .eote

**Who:** an OTE engineer who has a finished project and wants to try the tool on it.

### Steps

| # | Where | What the engineer does | What happens | Verdict |
|---|---|---|---|---|
| 1 | Landing `/` (prod and local) | Reads the hero. Clicks **Open an existing .eote** | Opens a new, empty project and the start pane "What are we building?". No file picker opens. The button does exactly what **Start a project** does (`StartButtons.tsx:655-670`) | Dead end (S4-14) |
| 2 | Start pane | Looks for "open" | Two big cards: "Start with the tag export" and "Start with the screens". The way to open a file is a small underlined line under them: "Or open a project you already have" | Unclear |
| 3 | Start pane | Clicks it and picks the .eote | `POST /api/import` succeeds. The canvas shows the screen: 1 screen, 19 objects, 7 tags in the status bar. The top bar shows the project name, "Saved", and "1024 × 600" | Works |
| 4 | Workspace | Presses F5, or comes back later from the Projects page | The start pane appears again over the project ("New project. What are we building? 7 tags are loaded..."). It covers the top bar and the nav rail. Escape does nothing. The only buttons are **Build it**, **Import a tag export** and **Open a project**. Typing anything and pressing Enter would run a build on the engineer's own project | **Dead end, P1 (S4-01)** |
| 5 | Workaround | Types `/project/<id>/tags` into the address bar, then clicks **Workspace** in the rail | The workspace opens normally | Only someone who knows the URL scheme finds this |
| 6 | Projects page | Looks at the card | "Opened just now · HMIST6500AWADI · 1024 × 600", 1 screen, 19 objects, 7 tags, 5 alarms. The line "Opened HMICopilot_PumpStation.eote" written at import is overwritten by the first autosave. So the card no longer says where the project came from | Minor |
| 7 | Projects page | Signs in, then clicks **Upload to cloud** | The card moves to "Saved on the server" as **"Version 3 ? HMIST6500AWADI"**. The "?" is a literal character (`ProjectsScreen.tsx:212`). There is no delete for a server project | P3 (S4-10); a gap |
| 8 | Projects page | Clicks the server card | The workspace opens, but with no **Share** button and no live session. That project id was already loaded once in this page load as a local project, so the cloud load and its access role are skipped (`useProjectHydration.ts:116`). A reload fixes it | P3 (S4-16) |
| 9 | Export | **Generate files** | Writes a zip (43.0 KB) holding the .eote (24.6 KB), Variables.csv (271 B), a validation report (16.0 KB) and a README. The page shows "11 warnings — worth a look, none of them blocking" and a green **verified** badge. The badge appears on every export, whatever was checked | Works. The badge claims too much (S4-17) |
| 10 | Export | Reads README.txt | It ends "This project was generated from a PLC tag export and a description... Nothing in it was hand-drawn." That is false for an opened file (`useExport.ts:109-110`) | P3 (S4-17) |

**Console on the way:** `favicon.ico` 404 on prod and locally. On prod the network log shows `GET /project//export → 308 → /project/export` and `GET /project//tags → 308 → /project/tags`. The top bar's Export link, and the chat's "Import a tag export" link, are built from the store's project id before it is known (S4-11). A click in that first moment opens a project whose id is "export".

### How the engineer could think about this differently

The engineer thinks "I have a project; let me open it and change something". The app answers with "What are we building?", which is a question about a new project. On every reopen it asks again, as if the project did not exist.

The app's terms are "tag export", "screens first" and "brief". The engineer's terms are "my project, its screens, what is wrong with them".

A flow built around their job:

1. **Open is the first verb, not the third.** The landing page's "Open an existing .eote" opens the file picker. The Projects page lists opened files with their origin ("from Station_A.eote, 4 screens carried as-is, 2 Grid screens not drawn").
2. **Opening shows a report, not a question.** It lists what was read, what was carried untouched, and what cannot be drawn yet, per screen. The import route already returns this (`carried`, `warnings`); only the Projects card uses it, and only once.
3. **A reopened project opens on its screens.** The start pane is for a project with nothing in it, decided after the project has loaded.
4. **The verbs are the engineer's.** "Fix the alarm banner on screen 3", "make these four pumps look the same", "check this against our standard". Today the Copilot's openers are "Create a screen for <equipment>" and "Add a high alarm on <tag>", which are generator verbs.

---

## Flow 3. A reviewer on a share link

**Who:**
- a lead engineer or a client who is sent a link to review screens, without an account (viewer link);
- the same, with an account (commenter link).

### Steps: the owner makes the links

| # | What the owner does | What happens | Verdict |
|---|---|---|---|
| 1 | Clicks **Share** in the top bar (only shown for a server project) | Dialog: "People with access" (just the owner), "Links: No links yet", "New link" with Role, "Expires after (days)" and "Allow export" | Works. There is no way to invite a named person by email: links only |
| 2 | **Create link** with role Viewer | "Link created. It is shown in full only now; this browser remembers it for Copy." The link is `/s/<token>`. The row reads "Viewer · Expires Nov 18" with Copy and Revoke | Works |
| 3 | Picks role Commenter | "Allow export" switches itself on (`ShareDialog.tsx:391`). The row reads "Commenter· can export" | Surprising default. A reviewer gets the file unless the owner notices (S4-18) |
| 4 | Turns on Comments in the canvas, clicks the banner, types a comment, presses Enter | Pin 1 on the banner, thread "#Banner · Audit local · just now" | Works |

### Steps: the viewer, signed out

| # | What the viewer does | What happens | Verdict |
|---|---|---|---|
| 5 | Opens the viewer link | "HMICopilot_PumpStation — shared view, read only", with the canvas, the inspector and the comment thread beside it. A **Sign in** button | Works |
| 6 | Looks at the console | `GET /api/projects/<id>/realtime-token → 401`. Comments are polled every 10 s (`comments` at 10.1 s, 20.2 s, 30.2 s, 40.2 s) | Expected. The token route refuses anonymous visitors on purpose |
| 7 | The owner, in a second tab, nudges the banner down 1 unit | The viewer's canvas shows the move by the time the tab is switched to (under 1 s of polling), through the event-stream fallback | **Live view works** |

### Steps: the reviewer, with an account

| # | What the reviewer does | What happens | Verdict |
|---|---|---|---|
| 8 | Opens the commenter link while signed out | "Sign in to open this project. This link makes you a commenter of a shared project, so it needs an account. Sign in - or make one, it takes a moment - and you will come straight back here." | Clear |
| 9 | Clicks **Sign in**, then "No account yet? Create one", and fills email, password and name | The account is made, the reviewer is signed in, and lands in `/project/<id>` as a member | Works. The labels Email, Password and Name are not tied to their inputs: the accessibility tree shows unnamed textboxes (S4-09) |
| 10 | Looks at the top bar | It shows **"Offline - saved on this device"**. Its tooltip: "You do not have permission for this action". The network log shows `PUT /api/projects/<id> → 403` without any edit. The autosave sends a read-only member's copy as a whole-snapshot save, and the failure is reported as being offline (S4-19) | **P2. Wrong and alarming message** |
| 11 | Looks at the Copilot pane | "View only — ask an editor for changes." No composer | Correct |
| 12 | Opens Comments and replies "Agree, grey ground..." | The reply appears under the owner's comment as "S4 Reviewer · just now", with Resolve | Works |
| 13 | Opens Export, then **Generate files** | Exports (the link allowed it) | Works as configured |
| 14 | Opens History | "No versions yet." **Save a checkpoint** is enabled for a commenter. History, Plant, Standards, Settings and Templates check no role (S4-20) | P3 |

### How the reviewer could think about this differently

A reviewer thinks in screens and decisions: "is screen 3 acceptable?", "what did I ask for last time, and was it done?". The app gives them the editor with its edit controls hidden. The things they need are elsewhere or missing:

- **No review state per screen.** There is no "approved / changes requested" per screen, and no list of the open threads across all screens.
- **No record of what changed since the last review.** Versions are per device and are not shown to a reviewer.
- **No printable review pack.** There is no PDF or HTML of every screen with its comments. The validation report holds the open comments, but only someone who exports gets it.
- **No invitation by name.** A link is a bearer token: whoever forwards the email forwards the access.

A flow built around their job:

1. The owner clicks "Ask for review", picks people and screens, and sets a due date.
2. The reviewer gets a page listing those screens, each with its comments and an Approve or Request changes button.
3. The owner sees per screen who approved which revision.
4. The sign-off is part of the export: the validation report already exists and is the natural home for it.

---

## Flow 2. An engineer starting from a plant brief

**Who:** an engineer designing screens before the PLC programmer has an export. The walk used the form path ("fill the brief in yourself"), which costs one model call fewer than drafting from a description. The walk was signed in as the throwaway account, so the new project saved to the server.

### Steps

| # | Where | What the engineer does | What happens | Verdict |
|---|---|---|---|---|
| 1 | Landing | **Start a project** | A new project, "Untitled_2", opens on the start pane. Every click of Start leaves another "Untitled" card on the Projects page, even when nothing is built | Clutter |
| 2 | Start pane | **Start with the screens** | Two choices: "Describe the plant" and "Or fill the brief in yourself". The button under the description box says **Build it**, although it only drafts a brief. The footer, "Then, without being asked: Equipment inferred from ISA-5.1 tag names", describes the tags path, not this one | Unclear labels |
| 3 | Brief form | **Or fill the brief in yourself** | The empty brief: "Add" with nine kinds only: Pump, Motor, Conveyor, Fan, Valve, Tank level, Flow, Pressure, Temperature. "A brief needs at least one unit before it can be built from." | No mixer, agitator, compressor, heat exchanger, analyser, drive or dosing skid (GAP-4) |
| 4 | Brief form | Adds Pump and Tank level | Each row shows "PMP_nnn" or "LT_nnn", a "feeds" select, "How many" (empty, amber), and signal chips (RUN FLT START STOP; PV HI LO). Each row warns "Pump has no count. Say how many there are." | Clear |
| 5 | Brief form | Sets 2 pumps, 1 tank and the plant name | "2 units, 11 placeholder tags. Alarms on HI, LO, FLT." **Confirm and build** turns on | Clear |
| 6 | Brief form | **Confirm and build** | The pane closes. The chat shows the request "Audit transfer station with 2 Pump, 1 Tank level. Build an overview, one screen per unit group, an alarm screen." and the model's reply. Then: **"Building on the server. The result will appear as a proposal for an editor to accept."** The engineer is the only member of a project made a minute ago. The build is still routed as a shared proposal, because any server project counts as shared (`chat/shared.ts:280-285`) (S4-21) | **P2: a solo engineer becomes their own reviewer** |
| 7 | Workspace | Waits | Nothing arrives in 80 s. The server holds the finished proposal ("Build: 3 screens; 0 errors, 2 warnings left"), but the Supabase transport never forwards `proposal` or `agent` events: only `lib/collab/browser.ts:69-70` does (S4-22) | **P1: the build looks lost** |
| 8 | Workspace | Reloads (and works around the start pane, S4-01) | The proposal card appears with **Accept** and **Discard**. The conversation is gone: the request and the reply are not in the reloaded project. Chat is not part of the change log, and the whole-snapshot save stands down while a live session runs (`persist.ts:169-179`) (S4-23) | P2 |
| 9 | Workspace | **Accept** | The card says "ACCEPTED BY S4 REVIEWER". After 20 s the status bar still reads "1 screen · 0 objects · 11 tags", while the server holds revision 4 with 3 screens (checked with GET `/api/projects/<id>`). No `/changes` fetch follows the accept, because no broadcast arrives (S4-24, the same root as S2's realtime finding) | **P1: Accept appears to do nothing** |
| 10 | Workspace | Reloads | "3 screens · 89 objects · 11 tags". The screens are PlantOverview, Pump101Group and Pump102Group. The tank has no screen of its own, and there is **no alarm screen**, although "Alarms" was on in the brief (S4-25) | P2 |
| 11 | Validation | **Run validation** | 40 findings: 0 errors, 2 warnings ("NavGo_Pump102Group_0 displays a value but is not bound to any tag"), 38 info. The info findings are "... is at 12, 84, off the 8px grid." on the generator's own objects | The generator fails its own lint. The warning on a navigation button is a false positive |
| 12 | Tags | Opens the page | "Assumed from the confirmed brief. 11 placeholder tags. Import the real export to bind the screens to it." Then "0 bindings proposed", and for each navigation button "left unbound: could be PMP_102_RUN or PMP_102_FLT or PMP_102_START, …". A screen-change button is offered pump tags | P3 |
| 13 | Export (from code, not clicked here) | Generate files | The .eote leaves the placeholders out (`lib/collab/package.ts:19`). Variables.csv writes all 11 of them, and the README calls it "a copy of what is already inside the .eote" (S4-06, proved by a test) | P2 |

Model calls used in this flow: one `/api/chat` and one server-side build. No 429 or quota error was seen.

### How the engineer could think about this differently

The brief is the best-aligned part of the product: units, counts and signals are how a process engineer talks. Four things still make the engineer think in the tool's terms:

- **The tag prefix.** `PMP_nnn` and `<PREFIX>_<NNN>_<SIGNAL>` are shown as the naming scheme. A site has its own tag standard (for example area-loop-function, `100-P-101A`), and the brief cannot express it.
- **Screens as "one per unit group".** An engineer plans screens as an ISA-101 hierarchy: a Level 1 overview, Level 2 area screens, Level 3 faceplates and popups, and an alarm summary. Here they get three toggles, and one of them was ignored.
- **The placeholder-then-bind model.** It is invisible until the Tags page. The engineer's own words would be "these screens are waiting for the I/O list". A visible "waiting for tags: 11" badge on every screen, with a one-click "bind now" when the export lands, says the same thing in their terms.
- **The review step.** For a solo engineer it should be the canvas ghosts that already exist for local projects, not a server proposal addressed to "an editor".

A flow built around their job:

1. The engineer pastes the P&ID equipment list, or types it.
2. They pick the site tag convention once, per company.
3. They see the screen hierarchy as a tree to tick.
4. They get screens drawn at once.
5. The I/O list is imported whenever it exists, and the binder reports what it matched.

---

## Flow 4. A claude.ai user on the connector

**Who:** an engineer who wants to work from Claude rather than the web app. Walked as far as the local server allows. No claude.ai account was connected, and the protocol itself is S3's. On the one wrong request the browser was redirected to claude.ai's error page; nothing was done there.

### Steps

| # | Where | What the user does | What happens | Verdict |
|---|---|---|---|---|
| 1 | Workspace top bar | Looks for the connector | A **Connections** link sits next to the user's name, and only once signed in. Nothing in the app says that a Claude connector exists, or what address to add in Claude | **Dead end (GAP-7)** |
| 2 | `/account/connections` | Reads it | "Connected clients: Nothing is connected. Add the connector in Claude and approve it to see it here." Under it: "Personal access tokens: For the MCP Inspector and Claude Code... Paste one into the connector's Authorization: Bearer header setting." The page has **no link back to the app** (0 anchors) and **no server URL** to paste | Dead end |
| 3 | Same page | Names a token "S4 audit", then **Create token** | "Copy this now. It is not stored and cannot be shown again." A 51-character `hmi_...` token in a read-only box, with no Copy button. The list shows "S4 audit · Created Nov 4, 2026 · expires Feb 2, 2027 · Revoke" | Works. Copy is by hand |
| 4 | `POST /api/mcp` with the token, `tools/list` | (from the page) | 200, 10 tools: list_projects, get_screens, find_tags, validate, render_screen, apply_ops, propose, generate, generation_status, generation_cancel | Works. There is no tool to bring in an .eote or a tag export, and none to export one (GAP-8) |
| 5 | `/oauth/authorize` with an unknown client | | "This connection cannot be approved. This client is not registered with HMI Copilot. Remove the connector and add it again." | Clear |
| 6 | `/oauth/authorize` with a registered client and `scope=mcp` | | An immediate redirect to the client's `redirect_uri` (claude.ai) with an error, and no page shown. That is correct OAuth for an unknown scope. If claude.ai sends a scope this server does not know, the user sees only claude.ai's "end_error" screen with no reason given | Check with S3 which scope claude.ai sends |
| 7 | `/oauth/authorize` without a scope | | "Connect S4 audit client. Signed in as S4 Reviewer (s4-commenter@hmicopilot.test). THIS WILL BE ALLOWED TO: Read the projects you can open...; Propose changes to those projects, which an editor still has to accept; Stay connected without asking you to sign in again. After you allow this, your browser will be sent to claude.ai. Only continue if you recognise that address." **Allow** / **Deny** | Clear. The heading uses the name the client registered for itself, so any client can call itself "Claude"; the host line is the real safeguard |

### How the user could think about this differently

A claude.ai user thinks "Claude, open my Station A project and tidy the pump screen". The connector offers `list_projects`, which only lists server projects. The user's .eote is on their laptop, and Claude has no tool to receive it. So the conversation has to start in the web app anyway: upload the file and sign in, before Claude can see anything. The user is also never told the connector exists.

A flow built around their job:

1. The web app's top bar has "Use from Claude".
2. It shows the server URL to paste and a one-line how-to.
3. It shows which projects Claude can see.
4. In Claude, the first tool call can take a file the user attaches and open it as a project.
5. Results come back as a link to the canvas with the proposal ghosted, which already exists for shared projects.
