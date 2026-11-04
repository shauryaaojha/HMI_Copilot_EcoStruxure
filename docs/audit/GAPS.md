# Gaps: what an OTE engineer needs that the app does not do yet

Audit 2026-11, stream S4. Ranked by how much each one blocks real use, from the four walks in `USER_FLOWS.md`. Evidence is a file:line, a test under `web/scripts/audit/`, or a live step (flow and step number).

A bug is something the app claims to do and does wrong; those are in `BUGS.md`. A gap is something it does not attempt. Where a gap is mostly a bug, the bug id is given.

| # | Gap | Who it blocks | Blocks real use? | Evidence |
|---|---|---|---|---|
| 1 | **A project cannot be reliably reopened.** The start pane appears on every hard load, on every open from the Projects page and after sign-in, and it has no way out to the canvas | Everyone, every day | **Yes: the first thing done on day two fails** | Bug S4-01. `Workspace.tsx:52-63`. Flow 1 step 4, flow 3 step 9 |
| 2 | **Changes made on the server never reach the open tab.** A build by the Copilot, an accepted proposal, or an MCP proposal only shows after a reload, and the conversation is gone after that reload | Every signed-in user, because any server project counts as shared | **Yes**: "I clicked Accept and nothing happened" | Bugs S4-21, S4-22, S4-23, S4-24. Flow 2 steps 6-10 |
| 3 | **There is no hand-drawing path from the start pane.** The three ways in are a tag export, a brief, or a file. An engineer who wants a blank 1024 × 600 screen to draw on has no "Skip" or "Blank screen" | Anyone who wants to try the canvas first | Partly. Workaround: type a URL and come back to the workspace | `StartPane.tsx:381-560`: no skip control |
| 4 | **The plant vocabulary is nine kinds.** The brief offers Pump, Motor, Conveyor, Fan, Valve, Tank level, Flow, Pressure and Temperature. There is no mixer or agitator, compressor, blower, heat exchanger, analyser (pH, conductivity, turbidity), VFD or drive, dosing skid, filter, or breaker and MCC. A custom unit's signals cannot be named | Water, chemical and HVAC engineers, the client's main market | **Yes**, for any plant beyond pumps and tanks | Flow 2 step 3. `lib/brief/catalogue.ts` |
| 5 | **No site tag convention.** Placeholders are always `<PREFIX>_<NNN>_<SIGNAL>`. A plant with `100-P-101A` style tags gets placeholders the binder has to guess back to | Brownfield sites with a naming standard | Partly. The binder rebinds by rules or by the model, but nothing can be reviewed before the binding | Flow 2 step 4. `BriefTable.tsx:352` |
| 6 | **No review or sign-off workflow.** A share link gives the editor with edits hidden. There is no per-screen approve or request-changes, no list of open threads across screens, no "changed since you last looked", no invitation by name or email, and no review pack | Reviewers, leads, clients doing a factory acceptance test | Yes, for handover. Comments themselves work | Flow 3. `ShareDialog.tsx` has links only. `CommentsPanel.tsx` lists the active screen's threads |
| 7 | **The connector cannot be discovered.** Nothing in the app says a Claude connector exists. `/account/connections` gives no server URL to paste, has no link back, and the token has no Copy button | claude.ai users | **Yes**: nobody finds it without the docs | Flow 4 steps 1-3 |
| 8 | **The connector cannot bring a project in or out.** The 10 MCP tools have no "open this .eote", no "import these tags" and no "export". A Claude user must first upload in the web app | claude.ai users with files on their laptop | Yes | Flow 4 step 4 (`tools/list` returned 10 tools) |
| 9 | **History is per device and partial.** Versions live in localStorage on the device that made them. A share-link member sees none. Restoring drops locks, groups, provenance and composites. Restoring the oldest of 20 versions does nothing | Anyone relying on History as a safety net | Partly | Bugs S4-02, S4-08. Flow 3 step 14 ("No versions yet") |
| 10 | **No project management on the server.** A server project cannot be deleted, renamed from the list, duplicated, or exported from the Projects page. Every click of "Start a project" leaves another "Untitled" card | Signed-in users | Partly: clutter, not a stop | `ProjectsScreen.tsx:207-215` (server cards have no actions). Flow 1 step 7, flow 2 step 1 |
| 11 | **The ISA-101 hierarchy is not expressed.** The brief's screens are three toggles (Overview, One per unit group, Alarms). There are no L1 / L2 / L3 levels, no faceplate or popup screens, and the Alarms toggle was ignored in the walk | Engineers who design to ISA-101 | Partly | Bug S4-25. Flow 2 step 10 |
| 12 | **The generated output fails its own lint.** 38 of the 40 findings on a freshly built project were the generator's own objects "off the 8px grid". Navigation buttons are flagged as unbound displays, and the binder offers them pump tags | Anyone trusting validation as a gate | Partly: noise hides real findings | Flow 2 steps 11-12 |
| 13 | **No compare with the source file.** An opened .eote cannot be compared screen by screen against what will be exported. The engineer cannot see "what will change in my file" before export | Brownfield engineers | Partly. The export is a black box apart from the counts | `ExportScreen.tsx:64-72`: counts only |
| 14 | **Panel choice is hidden.** The panel is set only in the command palette (Ctrl+K) or the small "1024 × 600" chip. The Copilot says "Change it in Project settings", but the Standards and Settings pages show it read-only | Anyone targeting a smaller panel | Partly | `requirements.ts:379`, `StandardsScreen.tsx:76-84` |
| 15 | **Accessibility.** Form labels are not tied to inputs anywhere `Field` is used. The sign-in, Settings and Share forms are unnamed for a screen reader | Users of assistive technology, and any accessibility audit by the client | Partly | Bug S4-09 (test). Prod `/signin` shows unnamed textboxes |
| 16 | **Settings claim what is not true.** "Nothing is uploaded" (projects sync to the server, and files go to `/api/import` and to the knowledge scan). "Correct tag names on import" is a toggle nothing reads | Anyone deciding whether client data may be put into the tool | **Yes, for a client with data rules** | Bugs S4-12, S4-13 |

## What the walks found that already works

These are worth keeping as they are:

- opening a tracked .eote and exporting it back as a zip with a report;
- the brief form, its warnings and its confirm gate;
- share links (viewer without an account, commenter with one);
- comments with pins and replies;
- live updates between two signed-in tabs (a 1-unit nudge was seen in the other tab within the poll);
- live updates to a signed-out viewer through the event-stream fallback;
- the PAT page;
- the OAuth consent page's wording, which names the redirect host.
