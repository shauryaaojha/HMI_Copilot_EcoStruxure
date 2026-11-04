# BUGS: every bug the 2026-11 audit found

*Branch `audit/2026-11` off `main` at `5fd701d`. Each bug was found by one stream (S1 format and model, S2 server and security, S3 MCP and agent, S4 client and flows, S5 canvas, S6 visuals, S0 the orchestrator) and then checked against the code by the orchestrator. Where a test is named, it lives in `web/scripts/audit/` and fails on the code at `5fd701d` for the stated reason. Run them all with:*

```
cd web && MONGODB_URI= npx vitest run --config scripts/audit/vitest.config.mts
```

Severity: **P0** data loss or security, **P1** a broken flow, **P2** wrong output, **P3** cosmetic. Status: **open**, **fixed** (commit), **needs Shaurya** (the exact change is given), **needs design** (which DESIGN_ doc), **won't fix** (why).

**Totals:** 82 bugs: P0 3, P1 12, P2 39, P3 28. (4 duplicates merged into the bug they repeat.)

## Summary

| Id | Sev | Bug | Where | Proof | Users hit | Status |
|---|---|---|---|---|---|---|
| [S1-03](#s1-03) | P0 | Editing one tag resets every other variable's InitialValue to the type default | web/src/lib/ote/databases.ts:140-143 (`UPDATE ... "InitialValue" = INITIAL[type]` for eve… | web/scripts/audit/s1-eote-writer.test.ts (fails with "TagA's InitialV… | importers who edit, add or rename a tag (any variables fing… | open · needs Shaurya |
| [S3-01](#s3-01) | P0 | Connector token scopes are recorded but never enforced: a read-only token can write | web/src/lib/mcp/caller.ts:92 puts `scopes` on the Caller. No tool reads them: `grep -n sc… | web/scripts/audit/s3-mcp-scope.test.ts fails with `read-only token (s… | connector users whose client asks for less than all scopes.… | open · needs Shaurya |
| [S1-05](#s1-05) | P0 | A rebuild retargets a carried binding onto a different part when its target is shared with a modelled wire | web/src/lib/ote/reader.ts:632-642 (a target used by a modelled wire is removed from `extr… | web/scripts/audit/s1-eote-writer.test.ts (fails with "the Visibility … | rare. Any project where an object has both a plain tag bind… | open · needs Shaurya |
| [S1-01](#s1-01) | P1 | The export route refuses every project that holds a Compound Object instance | web/src/lib/backend/types.ts:165-178. The cause is web/src/lib/ote/schema.ts:910-938 (PAR… | web/scripts/audit/s1-eote-writer.test.ts (fails with "export route wo… | every importer of a real OTE project that uses Compound Obj… | open |
| [S1-06](#s1-06) | P1 | Accepting an AI proposal reverts every edit made after the proposal was drawn | web/src/core/ops/apply.ts:1039-1041 (`commit` lands `run.patch` whole), web/src/store/pro… | web/scripts/audit/s1-ops-concurrency.test.ts (fails with "the enginee… | every user who touches the canvas while a proposal (any del… | open |
| [S2-01](#s2-01) | P1 | /signin?next= redirects off-site with a backslash or a tab | web/src/app/signin/page.tsx:41-43 (safeNext), used at :19 (server redirect) and :26 -> we… | web/scripts/audit/s2-signin-next-redirect.test.ts (fails with `next="… | anyone who follows a crafted link; every sign-in. | open |
| [S2-02](#s2-02) | P1 | Model-spending and compute routes accept anonymous callers | web/src/app/api/chat/route.ts:61-143, brief/draft/route.ts:21-38, generate/route.ts:22-88… | web/scripts/audit/s2-model-routes-anonymous.test.ts (fails with `anon… | all users, when someone scripts it; also every connector us… | open |
| [S2-04](#s2-04) | P1 | Four writers move a project's revision without a Realtime broadcast | web/src/lib/server/proposals.ts:148 (accept), web/src/app/api/projects/[id]/route.ts:24 (… | web/scripts/audit/s2-realtime-no-broadcast.test.ts (control passes; f… | every shared-project member once Realtime is on; proposal a… | open |
| [S2-07](#s2-07) | P1 | No quotas: open sign-up (and anonymous upload) can fill the database | web/src/app/api/upload/route.ts:6-13 (anonymous, 100 MB each, no count), web/src/lib/serv… | measured (above). Not exercised against Mongo or prod (would write li… | all users, once someone does it. | open · needs Shaurya |
| [S3-10](#s3-10) | P1 | Rendering a screen of height 50 px or less crashes the whole Node process (resvg panic) | web/src/lib/critic/render.ts:`screenToPng` (resvg `render()`). Reached from web/src/app/a… | web/scripts/audit/s3-model-routes-open.test.ts test 4 (fails: "one an… | anyone (critique is anonymous). Connector and agent users w… | open |
| [S4-01](#s4-01) | P1 | Reopening a project shows the "New project" start pane over it, with no way out | web/src/components/shell/Workspace.tsx:52-63 (with useProjectHydration.ts:121-126, which … | live: reload of /project/pmw1gbxb0 (1 screen, 19 objects, 7 tags) sho… | every user who reloads or reopens a project, every time. | open |
| [S4-22](#s4-22) | P1 | With Supabase Realtime on, server proposals and agent steps never reach the open tab | web/src/lib/collab/realtime.ts (no `proposal` or `agent` handler; only lib/collab/browser… | live: flow 2 step 7; `grep -n "proposal\\|agent" lib/collab/realtime.… | every signed-in user who uses the Copilot. | open |
| [S1-02](#s1-02) | P1 | A binding rebuild rewrites bindings the engineer did not touch (CO target SubType, source PropertyFullName) | web/src/lib/ote/bindings.ts:150-158 (`SubType: part.Type` writes "CompoundObject" for "Co… | web/scripts/audit/s1-eote-writer.test.ts (fails with "the untouched C… | importers whose project uses COs or carries PropertyFullNam… | open · needs Shaurya |
| [S2-03](#s2-03) | P1 | The laptop store silently drops generation jobs | web/src/lib/server/storage.ts:132-143 (table allow-list without "generationJobs"); writes… | web/scripts/audit/s2-filerepo-jobs.test.ts (fails with `FileRepo drop… | connector users testing locally (MCP Inspector), the shared… | open |
| [S2-06](#s2-06) | P1 | /api/knowledge reads, adds and deletes with no identity and no Origin check | web/src/app/api/knowledge/route.ts:26-77; related: web/src/lib/knowledge/privacy.ts:6-9 l… | web/scripts/audit/s2-knowledge-unguarded.test.ts (fails with `a forei… | laptop users browsing other sites while the app runs; any d… | open |
| [S1-09](#s1-09) | P2 | An op that names a screen edits the same-named object on another screen | web/src/core/ops/apply.ts:153-160 (`findPartByName` scans every screen and takes the firs… | web/scripts/audit/s1-ops-concurrency.test.ts (fails with "Banner on s… | chat, agent and MCP users who address by name on multi-scre… | open |
| [S2-08](#s2-08) | P2 | No security headers: pages can be framed, no CSP | web/next.config.ts (no `headers()`), no web/src/middleware.ts | prod (GET, read-only) headers for `/`, `/signin`, `/api/me` as above.… | every user; connector users most. | open |
| [S3-09](#s3-09) | P2 | tidyLayout, and the overlaps line the model is shown, cannot see overlaps inside a card | web/src/lib/ote/tidy.ts `unitsOf` folds every part held by a Rectangle card into one unit… | web/scripts/audit/s3-tidy-card-blind.test.ts (fails: "the symbol cove… | everyone who asks the chat to tidy a generated screen. The … | open |
| [S4-02](#s4-02) | P2 | History > Restore on the oldest of 20 versions does nothing, and logs "Restored version" | web/src/components/history/HistoryScreen.tsx:310-316; web/src/store/slices/collab.ts:381,… | web/scripts/audit/s4-history-restore-oldest.test.ts (fails with "rest… | anyone with a long session (versions are taken on every bui… | open |
| [S4-03](#s4-03) | P2 | A new project inherits the previous project's standards, including "Review every AI edit" | web/src/store/project.ts:536-567 (reset leaves `standards`); web/src/components/shell/use… | web/scripts/audit/s4-standards-leak-new-project.test.ts (fails with "… | anyone who changes a setting and starts another project. Th… | open |
| [S4-05](#s4-05) | P2 | Plant "Rebuild from tags" drops the ranges the engineer typed | web/src/components/plant/PlantScreen.tsx:305-306 | web/scripts/audit/s4-plant-rebuild-drops-ranges.test.ts (fails with "… | anyone correcting ranges. | open |
| [S4-07](#s4-07) | P2 | Undo after deleting a composite brings back loose parts; the composite is lost | web/src/store/state.ts:61-76 (EditSnapshot), web/src/store/internals.ts:22-45 | web/scripts/audit/s4-undo-delete-composite.test.ts (fails with "the p… | anyone undoing a delete of a generated indicator, tile or s… | open |
| [S4-12](#s4-12) | P2 | Standards "Correct tag names on import" toggle does nothing | web/src/components/standards/StandardsScreen.tsx:180-183 | measured: `grep -rn enforceNaming src tests scripts` → only Standards… | anyone relying on the switch. | open |
| [S4-13](#s4-13) | P2 | Settings says "Nothing is uploaded" when files and projects are uploaded | web/src/components/settings/SettingsScreen.tsx:112-114 | measured: flow 1 network log `POST /api/import`; flow 2 `PUT /api/pro… | anyone deciding whether client data may go in. | open |
| [S4-14](#s4-14) | P2 | Landing "Open an existing .eote" does the same as "Start a project" | web/src/components/landing/StartButtons.tsx:655-670; Sections.tsx:595-600 | live: flow 1 step 1 (prod and local). | every brownfield first visit. | open |
| [S4-15](#s4-15) | P2 | Projects page deletes a project in one click, with no confirm or undo | web/src/components/projects/ProjectsScreen.tsx:191-194, 357-365 | code: `remove()` calls `clearProject(id)` directly on click. | anyone; device-only projects have no other copy. | open |
| [S4-19](#s4-19) | P2 | A read-only member's tab PUTs the whole project and then shows "Offline - saved on this device" | web/src/components/shell/useProjectHydration.ts:228-297 (autosave with no role check); we… | live: flow 3 step 10, network `[PUT] /api/projects/pmw1gbxb0 => [403]… | every commenter and viewer member. | open |
| [S4-21](#s4-21) | P2 | Every server project is treated as shared, so a solo engineer's chat becomes a proposal "for an editor to accept" | web/src/components/chat/shared.ts:280-285 | live: flow 2 step 6. | every signed-in user. | open |
| [S4-23](#s4-23) | P2 | The conversation is lost on reload in any server project | web/src/store/persist.ts:169-179 (the whole-snapshot save stands down while live); web/sr… | live: flow 2 step 8. | every signed-in user. | open |
| [S5-01](#s5-01) | P2 | Paint order changed in the editor is lost on export for container-rooted screens | web/src/lib/ote/containers.ts:363-381 (mergeTree rebuild keeps original child order); rea… | web/scripts/audit/s5-layers-order-lost.test.ts (fails with "the expor… | importers who restack on any of the 16 of 26 Grid-rooted en… | open |
| [S5-02](#s5-02) | P2 | Align and distribute take composites apart | web/src/store/slices/objects.ts:187-218, web/src/store/edits.ts:53-128; selection of a wh… | web/scripts/audit/s5-align-collapses-composite.test.ts (fails with "e… | everyone who aligns generated faceplates or indicators; cha… | open |
| [S5-04](#s5-04) | P2 | Generated screens overflow the 320x240 panel the app offers | web/src/lib/ote/layout.ts:284 (title 620 wide), :320 (footer label 500 wide), :116/:148 (… | web/scripts/audit/s5-small-panel-layout.test.ts (fails with "expected… | anyone who picks HMISTU855 (rare) | open |
| [S5-06](#s5-06) | P2 | Snap-to-grid never puts an off-grid object on the grid | web/src/components/canvas/ScreenRenderer.tsx:314-317, 354-355 (rounds the drag delta), vs… | measured: 450 of 577 (78%) parts in the engineer files are off the 8 … | importers, every snapped drag | open |
| [S6-01](#s6-01) | P2 | Server rasteriser draws Line, PolyLine, Polygon, Bezier and Path strokes as hairlines | web/src/components/canvas/parts/Shapes.tsx:59, web/src/components/canvas/parts/GraphicObj… | web/scripts/audit/s6-server-render-strokes.test.ts (fails with "darke… | every PNG the app makes: | open |
| [S1-04](#s1-04) | P2 | Deleting a part leaves binding rows that target it | web/src/lib/ote/packager.ts:575-576. Bindings.dat is rewritten only when the modelled wir… | web/scripts/audit/s1-eote-writer.test.ts (fails with "binding rows st… | importers deleting objects with unmodelled bindings (expres… | open · needs Shaurya |
| [S1-10](#s1-10) | P2 | A MasterScreen is not modelled: every screen of the project is shown without its frame | web/src/lib/ote/schema.ts:889-891 (`Type: z.enum(["Screen","Content"])`) and web/src/lib/… | measured by fidelity.mts. Panel1 carriedScreens `Screens:MasterScreen… | importers of any project that uses master screens. These ar… | open |
| [S1-12](#s1-12) | P2 | Variables of TIME, USINT and Machine Expert structured or FB types are not modelled | web/src/lib/ote/schema.ts:946-957 (DATA_TYPES) and web/src/lib/ote/reader.ts:531-534 (row… | measured by fidelity.mts (inventory.variables.byDataType) | importers of Machine Expert projects. | open |
| [S2-12](#s2-12) | P2 | Snapshots between 16 MB and 64 MB are accepted and then fail to save on Mongo | web/src/lib/server/snapshot.ts:9 and web/src/lib/client/snapshot.ts:216 (64 MiB cap) vs s… | measured: BSON maximum document size 16 MiB vs code cap 64 MiB (67,10… | importers of large projects on the deployment. | open |
| [S2-13](#s2-13) | P2 | Size limits on whole-body routes are unreachable on Vercel | web/src/app/api/tags/parse/route.ts:18,21-35; web/src/app/api/vijeo/migrate/route.ts:29-3… | code; the platform ceiling is the one lib/client/upload.ts:1-5 and li… | importers with large tag lists or Vijeo backups. | open |
| [S1-07](#s1-07) | P2 | Two clients adding objects at the same time get the same handle | web/src/store/internals.ts:63-66 and web/src/store/slices/objects.ts:67 (`o${++handleSeq}… | web/scripts/audit/s1-ops-concurrency.test.ts (fails with "handles hel… | sharers co-editing, and the Copilot/agent working while an … | open |
| [S1-08](#s1-08) | P2 | Concurrent edits to different properties of one part: one is lost, and no base check reports it | web/src/lib/server/repo-live.ts:99-135 (applies in arrival order; `change.base` is never … | web/scripts/audit/s1-ops-concurrency.test.ts (fails with "A's text, o… | sharers co-editing the same object. The Copilot accepting a… | open |
| [S2-05](#s2-05) | P2 | Anyone can lock any account out of sign-in | web/src/lib/server/credentials.ts:119-120 (both limits counted before the password is che… | web/scripts/audit/s2-signin-lockout-dos.test.ts (fails with `the owne… | rare, but any named user an attacker picks; also the connec… | open |
| [S2-10](#s2-10) | P2 | Any member, including a viewer who joined by link, gets every member's email address | web/src/app/api/projects/[id]/members/route.ts:15-27 (`email: user?.email`) | web/scripts/audit/s2-access-leaks.test.ts (fails with `a viewer read … | sharers. | open |
| [S2-15](#s2-15) | P2 | Sign-out does not end a session; a copied cookie works for 30 days | web/src/auth.ts:25 (`session: { strategy: "jwt" }`, no maxAge, no adapter); Auth.js defau… | local (production build): signed in as s2-a (cookie `authjs.session-t… | all signed-in users, on shared machines. | open |
| [S3-05](#s3-05) | P2 | The token endpoint does not bind codes and refresh tokens to the client | web/src/lib/server/oauth.ts:540-543 (`if (clientId && clientId !== code.clientId)`) and o… | web/scripts/audit/s3-oauth-client-binding.test.ts (fails with "a publ… | connector users (none affected in normal use). | open · needs Shaurya |
| [S3-06](#s3-06) | P2 | MCP generate takes a brief with an unbounded unit count | - web/src/lib/mcp/generate.ts:111 `count: z.number().int().optional()`; | web/scripts/audit/s3-brief-count.test.ts (fails: "problemsWith accept… | connector users, rarely. Only a client that sends the brief… | open |
| [S1-11](#s1-11) | P2 | setColor and setText report success with no visible change on several types | web/src/core/ops/apply.ts:766-767 (setColor always writes the top-level `Fill.Color.Value… | measured by fidelity.mts. Applied but not visible: setColor TextBox 1… | chat, agent and MCP users restyling objects. | open |
| [S3-03](#s3-03) | P2 | alignObjects silently drops targets it cannot find, and reports a no-op spread as done | web/src/core/ops/apply.ts:879-881 drops unresolved names without a word; it rejects only … | web/scripts/audit/s3-align-partial.test.ts (2 of 2 fail with the mess… | chat and MCP users who ask to align, whenever the model mis… | open |
| [S4-06](#s4-06) | P2 | Variables.csv exports placeholder tags that the .eote leaves out | web/src/components/export/useExport.ts:129-131 | web/scripts/audit/s4-variables-csv-placeholders.test.ts (fails with "… | screens-first users who hand the CSV to the PLC programmer. | open |
| [S4-08](#s4-08) | P2 | Restoring a version drops locks, groups, provenance keys and bind intents | web/src/store/types.ts:117-125 (Version), web/src/store/slices/collab.ts:364-401 | web/scripts/audit/s4-restore-drops-meta.test.ts (fails with "the rest… | History and "revert to here" users. Regeneration then treat… | open |
| [S4-25](#s4-25) | P2 | The brief's "Alarms" screen is not built | the generator path from requestFromBrief (lib/brief) to the pipeline. Not my file; hit in… | live: flow 2 step 10. | screens-first users. | open |
| [S6-04](#s6-04) | P2 | A level 2 card's equipment symbol overlaps its first analogue indicator | web/src/lib/ote/layout.ts:454 (symbol at y+8, 52 px tall) vs web/src/lib/ote/layout.ts:51… | web/scripts/audit/s6-card-symbol-overlap.test.ts (fails with "18 symb… | generators whose units have readings but no run or fault BO… | open |
| [S3-02](#s3-02) | P2 | The agent can delete the project's core files: delete_path on a folder or "", and run_script ws.delete | web/src/lib/agent/tools.ts:275-280 tests `CORE` only against the path it was given, then … | web/scripts/audit/s3-agent-core-delete.test.ts. 3 of its 4 tests fail… | Agent-tab users, rarely. It needs the model to delete a fol… | open |
| [S3-07](#s3-07) | P2 | The agent's regex tools block the event loop on a catastrophic pattern | web/src/lib/agent/tools.ts:104-111 `pattern()` compiles any model-supplied regex. It is r… | web/scripts/audit/s3-agent-redos.test.ts (fails with "one search call… | Agent-tab users, rarely. The pattern can come from a confus… | open |
| [S0-01](#s0-01) | P3 | A stale local build breaks `tsc --noEmit` | web/tsconfig.json:36 (`".next-build/types/**/*.ts"` in `include`) | measured on this machine at baseline (3 errors with the stale dir, 0 … | every developer who used the documented `NEXT_DIST_DIR=.nex… | open |
| [S4-09](#s4-09) | P3 | Form labels are not tied to their inputs (sign-in, settings, share) | web/src/components/ui/Field.tsx (label htmlFor={id}; the id is never given to the child) | web/scripts/audit/s4-signin-labels.test.ts (fails with "labels point … | assistive-technology users; every Field in the app. | open |
| [S4-30](#s4-30) | P3 | The Projects card loses "Opened <file>" on the first autosave | web/src/components/shell/useProjectHydration.ts:275-287 (touchProject `intent` from chat)… | live: flow 1 step 6. | every opened file. | open |
| [S5-07](#s5-07) | P3 | Inspector geometry fields commit on every keystroke, through 0 | web/src/components/inspector/Inspector.tsx:310-322; each call is a setBox with its own un… | code. BindingEditor.tsx:133-137 commits on blur for exactly this reas… | everyone who types a coordinate | open |
| [S6-03](#s6-03) | P3 | Every generated bar is drawn empty on the canvas and in the PNG | web/src/lib/ote/parts.ts:89,116 (writes 0), web/src/components/canvas/parts/BasicParts.ts… | measured: 82 bars with fill 0 on 36 pipeline screens (web/scripts/aud… | all users who generate screens (every AnalogIndicator). | open |
| [S1-13](#s1-13) | P3 | Resizing or deleting a ContentDisplay: the editor keeps the old layout of the content it shows | web/src/lib/ote/reader.ts:192-197 and 434-435 (content laid out at the display's size onl… | measured by fidelity.mts (resize and delete ContentDisplay: 10 boxes … | importers of template-style projects. | open |
| [S1-14](#s1-14) | P3 | HMIST6600 (1280x800), the panel of every engineer file, is not in the panel list | web/src/lib/backend/panels.ts:207-213 | measured by fidelity.mts. Target.dat in 4/4 engineer files says HMIST… | importers. | open |
| [S5-03](#s5-03) | P3 | The board scrolls a double-click zoom to the wrong place when screens differ in size | web/src/components/canvas/CanvasPane.tsx:185, 289-297, 364-376 vs web/src/components/canv… | web/scripts/audit/s5-board-placement.test.ts (fails with "frame 2 is … | importers of projects with content screens (8 of 26 enginee… | open |
| [S6-02](#s6-02) | P3 | Server PNG has a transparent background where no part covers the screen | web/src/components/canvas/StaticScreen.tsx:107 (`style={{ background: PAPER }}`) | web/scripts/audit/s6-server-render-strokes.test.ts (fails with "the c… | screens with no full-screen ground Rectangle: imported scre… | open |
| [S6-05](#s6-05) | P3 | Rectangle CornerRadius is carried but never drawn | web/src/components/canvas/parts/BasicParts.tsx:31-38 (plain `<rect>`, no rx/ry) | measured: 1 `CornerRadius` in each of `HMICopilot_Panel1.eote`, `Moto… | importers, rarely (one per engineer project). | open |
| [S4-18](#s4-18) | P3 | Commenter and editor links get "Allow export" switched on by default | web/src/components/shell/ShareDialog.tsx:391 | live: flow 3 step 3. | sharers; a reviewer receives the client's file. | open |
| [S4-20](#s4-20) | P3 | History, Plant, Standards, Settings and Templates check no role | HistoryScreen.tsx:326-335, PlantScreen.tsx (no useCanEdit), StandardsScreen.tsx, Settings… | live: flow 3 step 14 (`checkpoint=true` for a commenter). | share-link members. The local change then fails to save (S4… | open |
| [S1-15](#s1-15) | P3 | Two skip conditions hard-code Shaurya's home folder | web/tests/struct.test.ts:187 and web/tests/contents.test.ts:140 (`C:/Users/shaur/Download… | measured: baseline-vitest.txt. | developers. The 95-template breadth test never runs outside… | open |
| [S2-14](#s2-14) | P3 | The per-IP sign-in limit trusts a client-supplied X-Forwarded-For | web/src/lib/server/rate-limit.ts:78-81 | local: after my two requests, web/.data/signInAttempts holds key `ip:… | self-hosted deployments. | open |
| [S4-04](#s4-04) | P3 | Placing a template twice labels both blocks "PUMP 1" | web/src/components/templates/TemplatesScreen.tsx:115-117 | web/scripts/audit/s4-template-numbering.test.ts (7 failures, e.g. "pu… | template users. | open |
| [S4-10](#s4-10) | P3 | Server project card reads "Version 3 ? HMIST6500AWADI" | web/src/components/projects/ProjectsScreen.tsx:212 | live: Projects page text "Version 3 ? HMIST6500AWADI". | all signed-in users. | open |
| [S4-16](#s4-16) | P3 | Opening a just-uploaded server project from the Projects page shows no Share button and no live session | web/src/components/shell/useProjectHydration.ts:116-117 (hydratedFor skips the cloud load… | live: flow 1 step 8 (header text had no "Share"; after reload it did). | uploaders, once. | open |
| [S4-17](#s4-17) | P3 | Export claims too much: a "verified" badge on every export, and "Nothing in it was hand-drawn" in the README | web/src/components/export/ExportScreen.tsx:286-295; web/src/components/export/useExport.t… | live: flow 1 step 9 ("verified"). | all exporters. | open |
| [S4-26](#s4-26) | P3 | Landing says "699 tests" | web/src/app/page.tsx:204 | live: prod landing text. | all visitors. | open |
| [S4-29](#s4-29) | P3 | The start pane shows a generic brief error instead of the server's | web/src/components/shell/StartPane.tsx:151-153, 168-171 (reads `brief.error` from the ren… | code: stale closure over `brief`. | screens-first users on a model failure. | open |
| [S5-08](#s5-08) | P3 | Regenerate "Back" leaves the ghosts on the canvas | web/src/components/canvas/RegenerateDialog.tsx:86-93 (sets preview only in review, never … | code path; no DOM test environment | users of regenerate | open |
| [S5-09](#s5-09) | P3 | Library drops ignore what is on the screen and the panel edge | web/src/components/library/LibraryPanel.tsx:167-186, web/src/components/library/LibrarySc… | arithmetic from the code. Measured on the real files: 0 screens curre… | users of the library | open |
| [S2-09](#s2-09) | P3 | Signed-out callers can tell which project ids exist | web/src/lib/server/access.ts:68 (404 before the identity check in requireReader), used by… | web/scripts/audit/s2-access-leaks.test.ts (fails with `the status tel… | rare. | open |
| [S2-11](#s2-11) | P3 | The Realtime INSERT policy lets any token holder broadcast forged notices | supabase/migrations/20261030170741_realtime_policies.sql:46-51; token TTL web/src/lib/rea… | code (policy lines above); not run (no Supabase credentials used by t… | rare. | open · needs Shaurya |
| [S2-16](#s2-16) | P3 | The live change path skips the checks a whole-snapshot save makes | web/src/lib/collab/changes.ts:948-949 (`setField` checks only the field name); compare we… | code (no test written: time). | rare (needs an editor). | open |
| [S4-11](#s4-11) | P3 | Top-bar Export link and chat "Import a tag export" link point at /project//… before the project loads | web/src/components/shell/TopBar.tsx:137, 253; web/src/components/chat/ChatPanel.tsx:82, 2… | live prod network log: `GET /project//export?_rsc=… => 308`, `GET /pr… | rare (first second after load). | open |
| [S4-27](#s4-27) | P3 | Ctrl+K opens the palette from inside a text field | web/src/components/shell/CommandPalette.tsx:230-242 | code: no target check in onKeyDown. | rare. | open |
| [S4-28](#s4-28) | P3 | On a network failure, the generation log says "replaying the bundled demo screen", then nothing is built, and a fresh r… | web/src/components/generation/useGeneration.ts:227-236; useChat.ts:212-224 (stopped is un… | code path: mockGeneration's error event is applied but not returned a… | rare (offline). | open |

## P0

### S1-03

**Editing one tag resets every other variable's InitialValue to the type default**

- Status: open
- Severity: P0 data loss
- Where: web/src/lib/ote/databases.ts:140-143 (`UPDATE ... "InitialValue" = INITIAL[type]` for every kept variable)
- Repro: open a project whose variables have initial values, change one tag's comment, then export.
- Expected: the other variables' InitialValue is unchanged.
- Actual: every modelled variable's InitialValue becomes "0", "False" and so on.
- Proof: web/scripts/audit/s1-eote-writer.test.ts (fails with "TagA's InitialValue after an edit to TagC: expected '0' to be '42'"). Measured: 22 of the 120 modelled variables in each engineer file carry a non-default InitialValue (fidelity-probe.mts).
- Users hit: importers who edit, add or rename a tag (any variables fingerprint change).
- Fix: UPDATE only the columns the model owns (Name/DataType/Comments/DeviceAddress), and set InitialValue only when DataType changed. This touches writer output (it now keeps the original), so needs Shaurya to agree.
- Last audit: new

### S3-01

**Connector token scopes are recorded but never enforced: a read-only token can write**

- Status: open
- Severity: P0 (security: what the engineer consented to does not limit the token)
- Where: web/src/lib/mcp/caller.ts:92 puts `scopes` on the Caller. No tool reads them: `grep -n scopes web/src/lib/mcp/*.ts` finds only caller.ts:33,48,92. The write path at web/src/lib/mcp/write.ts:184 (`land`) and web/src/lib/mcp/write.ts:288 (`propose`) checks only the project role.
- Repro:
  1. A client asks for `scope=mcp:read`. The consent page lists only "Read the projects you can open..." (web/src/app/oauth/authorize/page.tsx:72-77).
  2. The token is issued with `scope: "mcp:read"`. This was shown live: in step 15 of SCRATCH\s3\oauth-flow.sh the token response said `scope mcp:read`.
  3. Call `propose` or `apply_ops` with that token.
- Expected: the call is refused. The MCP authorization spec, "Scope Challenge Handling", says to answer 403 `insufficient_scope`. At the least the tool result should be isError.
- Actual: HTTP 200, and a proposal is queued. On a project with direct writes turned on, `apply_ops` writes straight away.
- Proof: web/scripts/audit/s3-mcp-scope.test.ts fails with `read-only token (scopes ["mcp:read"]) was NOT refused: HTTP 200, isError=undefined, proposals queued=1`.
- Users hit: connector users whose client asks for less than all scopes. Claude asks for the scopes in `scopes_supported`, so Claude itself gets write. The risk is any other DCR client, and the consent screen showing less than the token can do.
- Fix: in `runTool` (web/src/lib/mcp/tools.ts:26), refuse any tool whose `annotations.readOnlyHint` is not true unless `caller.scopes` is empty or holds `mcp:write`. Optionally return HTTP 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope="mcp:write"`. That second part changes the MCP wire format, so it needs Shaurya.
- Last audit: new

### S1-05

**A rebuild retargets a carried binding onto a different part when its target is shared with a modelled wire**

- Status: open
- Severity: P0 data loss (silent rebinding)
- Where: web/src/lib/ote/reader.ts:632-642 (a target used by a modelled wire is removed from `extra.targets`) and web/src/lib/ote/packager.ts:396 (`targetMap.get(b.Target) ?? b.Target` keeps the stale number, which then indexes some other target)
- Repro: a part with one variable wire and one binding through a non-Scale converter (Visibility, say). Delete any other bound part, then export.
- Expected: the carried binding still targets its own part.
- Actual: it targets another part (in the test, PartC).
- Proof: web/scripts/audit/s1-eote-writer.test.ts (fails with "the Visibility binding now targets PartC"). Measured: 0 such shared targets in the 15 files here (fidelity-probe.mts), so the corpus does not hit it today.
- Users hit: rare. Any project where an object has both a plain tag binding and an expression or other-converter binding.
- Fix: keep in `extra.targets` every target that an extra binding references, and remap through it. This changes writer output, so needs Shaurya.
- Last audit: new

## P1

### S1-01

**The export route refuses every project that holds a Compound Object instance**

- Status: open
- Severity: P1 broken flow
- Where: web/src/lib/backend/types.ts:165-178. The cause is web/src/lib/ote/schema.ts:910-938 (PART_TYPES has no "CompoundObject") feeding web/src/lib/backend/ote.ts:24, as enforced by web/src/app/api/export/route.ts:99-109.
- Repro: open demo_project/HMICopilot_Panel1.eote, samples/hmi-panel-1/auto-manual.eote or demo_project/HMICopilot_Drive_4.1.eote, change anything, then export.
- Expected: the .eote downloads.
- Actual: `409 {"error":"EcoStruxure Operator Terminal Expert 4.4 cannot write CompoundObject: 10 objects would be lost."}`. The writer itself writes the file correctly.
- Proof: web/scripts/audit/s1-eote-writer.test.ts (fails with "export route would answer 409 'cannot write CompoundObject': expected [ 'CompoundObject' ] to deeply equal []"). Measured: 3 of 4 distinct engineer files, 100 % of their exports; it drops the user-facing survival from 95.8 % to 66.1 %.
- Users hit: every importer of a real OTE project that uses Compound Objects (the engineer's buttons and gauges are COs).
- Fix: add "CompoundObject" to OTE's writable parts (backend/ote.ts:24 or PART_TYPES). Check that the ops `type` enum and backend.test.ts:82 still mean what they say. This does not change the writer's output format.
- Last audit: new

### S1-06

**Accepting an AI proposal reverts every edit made after the proposal was drawn**

- Status: open
- Severity: P1 broken flow (it loses the engineer's own edits, and in a live project those of collaborators that arrived meanwhile)
- Where: web/src/core/ops/apply.ts:1039-1041 (`commit` lands `run.patch` whole), web/src/store/project.ts:185-191 (`restoreSlice` replaces screens, bindings, alarms, handles), and web/src/components/chat/useChat.ts:462-473 (Accept commits the stored run)
- Repro: ask the Copilot to delete an object, so a proposal appears. Drag another object. Click Accept.
- Expected: the delete lands, and the drag stays.
- Actual: the drag is undone, and the client then diffs and syncs the reversion.
- Proof: web/scripts/audit/s1-ops-concurrency.test.ts (fails with "the engineer's drag after the proposal: expected 20 to be 60")
- Users hit: every user who touches the canvas while a proposal (any delete, or any rejected op) waits. Shared projects use the server path, which re-runs the ops (proposals.ts:141-143), so this is the browser-only path.
- Fix: on Accept, re-run the ops with `dryRun` against the live store, as the partial accept already does (useChat.ts:462), or commit only the diff of the run.
- Last audit: new

### S2-01

**/signin?next= redirects off-site with a backslash or a tab**

- Status: open
- Severity: P1 (security: open redirect after a real sign-in, usable for phishing and as a step in the connector consent flow, which also routes through /signin?next=)
- Where: web/src/app/signin/page.tsx:41-43 (safeNext), used at :19 (server redirect) and :26 -> web/src/components/shell/SignInForm.tsx:58 (`window.location.assign(next)`)
- Repro: send `https://hmibuildtimecopilot.vercel.app/signin?next=/%5Cevil.example` (or `/%09/evil.example`); the victim signs in; the browser goes to https://evil.example/. A signed-in visitor is redirected immediately by the server (307 Location `/\evil.example`).
- Expected: only a same-site path survives; anything else becomes "/".
- Actual: `startsWith("/") && !startsWith("//")` passes `/\evil.example` and `/\t/evil.example`; the WHATWG URL parser reads `\` as `/` and strips tabs, so both resolve to https://evil.example/.
- Proof: web/scripts/audit/s2-signin-next-redirect.test.ts (fails with `next="/\\evil.example" redirected to https://evil.example/`); local (signed in as s2-a): `GET /signin?next=/%5Cevil.example` -> 307 `location: /\evil.example`, `next=/%09/evil.example` -> 307 `location: /<TAB>/evil.example`, while `//evil.example` and `https://evil.example` -> 307 `location: /`; prod (GET, read-only): `/signin?next=/%5Cevil.example` renders `"next":"/\\evil.example"` into the form props, and `/%09/evil.example` renders `"next":"/\t/evil.example"`; `https://evil.example` and `//evil.example` are correctly reduced to `/`.
- Users hit: anyone who follows a crafted link; every sign-in.
- Fix: resolve the value against a fixed base and accept only when the origin is unchanged (`new URL(v, "http://x").origin === "http://x"`), also rejecting `\` and control characters; return pathname+search+hash.
- Last audit: new

### S2-02

**Model-spending and compute routes accept anonymous callers**

- Status: open
- Also reported as: S3-04 (merged here)
- Severity: P1 (cost and availability: one shared Gemini key; anyone on the internet can spend it, and when the quota is gone the product's chat, brief, agent and connector all stop for everyone)
- Where: web/src/app/api/chat/route.ts:61-143, brief/draft/route.ts:21-38, generate/route.ts:22-88, critique/route.ts:25-58, tags/match/route.ts:20-26 (model via matchTags, lib/ai/draft.ts:209), agent/route.ts:36-115 (anonymous allowed at :52-55, maxDuration 300, `message` uncapped); compute-only and also anonymous: regenerate, validate, export (projectless), export/report, import/screens, tags/parse, vijeo/migrate.
- Repro: on a deployment with AUTH_SECRET set and no cookie, POST /api/chat `{history:[{role:"user",text:"hi"}],digest:{}}` -> 200 with a model turn.
- Expected: 401 before any model call (or at least a per-IP/per-user rate limit like the MCP generate job has, rate-limit.ts:60-61).
- Actual: no identity check and no rate limit; production advertises the configured model at GET /api/provider (`gemini-flash-lite-latest`).
- Proof: web/scripts/audit/s2-model-routes-anonymous.test.ts (fails with `anonymous POST /api/chat reached the model: expected { status: 200, modelCalls: 1 } to deeply equal { status: 401, modelCalls: +0 }`, same for /api/brief/draft). Not exercised on prod (POST forbidden for this audit).
- Users hit: all users, when someone scripts it; also every connector user (shared quota).
- Fix: `userRequired()` (or a signed-in-or-laptop check) on chat, brief/draft, generate, critique, tags/match, agent; reuse `countAttempt` per user and per IP for model routes. Note the anonymous browser-only mode on Vercel would lose the Copilot: Shaurya must decide whether anonymous Copilot use is a product feature.
- Last audit: new

### S2-04

**Four writers move a project's revision without a Realtime broadcast**

- Status: open
- Also reported as: S4-24 (merged here)
- Severity: P1 (broken flow for live sync on the Realtime transport: other people do not see an accepted Copilot proposal, a save, a restore or a claude.ai write until someone else happens to post an edit)
- Where: web/src/lib/server/proposals.ts:148 (accept), web/src/app/api/projects/[id]/route.ts:24 (PUT save), web/src/app/api/projects/[id]/versions/route.ts:16 (restore), web/src/lib/mcp/write.ts:236 (MCP direct write); the only publisher is web/src/app/api/projects/[id]/changes/route.ts:32-40,57.
- Repro: with Realtime configured, member A on the Realtime transport; member B accepts a proposal. A's channel receives nothing; realtime.ts:246-249 only fetches on a broadcast.
- Expected: every committed revision change is announced (the plan's rule, PLAN_FULL_ARCHITECTURE.md §2.3).
- Actual: only POST /changes announces. The SSE transport is unaffected (it polls).
- Proof: web/scripts/audit/s2-realtime-no-broadcast.test.ts (control passes; fails with `accepting a proposal moved the revision without a broadcast: expected { revMoved: true, broadcasts: +0 } to deeply equal { revMoved: true, broadcasts: 1 }`, and the same for PUT save and restore). The MCP path is code evidence only (S3's file).
- Users hit: every shared-project member once Realtime is on; proposal accept is the main Phase D flow.
- Fix: move `announce()` into one helper (e.g. lib/realtime/publish.ts `announceRevision`) and call it after `live.append`, `projects.save` and `versions.restore` wherever they are reached from a route or MCP tool. Proposals and agent steps also need an event on the channel (or a periodic GET) for Realtime sessions: today they are SSE-only (stream/route.ts:28 vs realtime.ts:246); S4 owns the client half.
- Last audit: new

### S2-07

**No quotas: open sign-up (and anonymous upload) can fill the database**

- Status: open
- Severity: P1 (availability and data loss: when Mongo is full every save, change and sign-up fails for every user)
- Where: web/src/app/api/upload/route.ts:6-13 (anonymous, 100 MB each, no count), web/src/lib/server/repo.ts:276-283 (sources permanent for accounts), :201-208 (projects), :303-308 (uploads); web/src/app/api/import/route.ts:134 (every signed-in import stores a permanent copy); comments have no count limit (repo-collab.ts:212-229)
- Repro: sign up (50 accounts per IP per 15 min allowed), then loop: POST /api/upload size 100 MB, PUT 25 parts, complete. Or anonymously: uploads live 24 h each.
- Expected: per-account and per-IP caps on stored bytes and object counts, and a cap on anonymous bytes in flight.
- Actual: none. measured: `grep -n "quota|MAX_PROJECTS|perUser|countDocuments" web/src/lib/server` -> 0 matches.
- Proof: measured (above). Not exercised against Mongo or prod (would write live data).
- Users hit: all users, once someone does it.
- Fix: a per-owner bytes/objects counter checked in `sources.put`, `uploads.create` and `projects.create`; a global anonymous ceiling; optionally invite-only sign-up (a setting: needs Shaurya to decide; Atlas tier size also needs Shaurya).
- Last audit: new

### S3-10

**Rendering a screen of height 50 px or less crashes the whole Node process (resvg panic)**

- Status: open
- Severity: P1 (security and availability: one anonymous request to /api/critique kills the server instance. The same renderer serves MCP `render_screen` and the agent's `view_screen`.)
- Where: web/src/lib/critic/render.ts:`screenToPng` (resvg `render()`). Reached from web/src/app/api/critique/route.ts:39-42 with no caller check and no size bounds (the ViewBox schema only says `positive()`, web/src/lib/ote/schema.ts:796-797). Also from web/src/lib/mcp/read.ts:183 and web/src/lib/agent/tools.ts:616.
- Repro: `POST /api/critique {screen: <demo screen with Children[0].Height = 2>, renderOnly: true}`. SCRATCH probe: web/scripts/audit/s3-render-probe.mts 1024 2.
- Expected: 400 for a degenerate canvas, or a PNG. Never a dead process.
- Actual: `thread '<unnamed>' panicked at ...resvg\src\geom.rs:27:61: called Option::unwrap() on a None value`. The process exits with code 127 (tsx) or 3221226505 (0xC0000409, node fail-fast).
  - Heights of 2 and 50 crashed. 600 and 9000 did not.
  - Large canvases are not capped either: 16000x9000 rendered with 673 MB RSS in 3.6 s.
- Proof: web/scripts/audit/s3-model-routes-open.test.ts test 4 (fails: "one anonymous renderOnly request with Height 2 ended the Node process with exit 3221226505: panicked at ...geom.rs:27:61"). **Not run against the shared server, on purpose: it would take it down.**
- Users hit: anyone (critique is anonymous). Connector and agent users whose project has a thin screen.
- Fix: clamp or refuse canvas sizes before resvg, for example both sides between 64 and 4096, in `screenToSvg`/`screenToPng`. Add a sign-in and rate-limit on /api/critique (S3-04).
- Last audit: new

<!-- BUGS-END -->

### S4-01

**Reopening a project shows the "New project" start pane over it, with no way out**

- Status: open
- Severity: P1 broken flow
- Where: web/src/components/shell/Workspace.tsx:52-63 (with useProjectHydration.ts:121-126, which loads asynchronously)
- Repro: open any project with content (local or server), then press F5, or open it from the Projects page after a reset, or sign in and click Workspace before the cloud load finishes.
- Expected: the workspace opens on the project's screens.
- Actual: "New project. What are we building? 7 tags are loaded..." covers the whole viewport, including the top bar and the nav rail. Only Build it, Import a tag export and Open a project are offered; Escape does nothing. The latch reads the store before the async load has filled it (initial `screens: []`, so `every()` is true), and then never re-evaluates. The comment on line 55 ("the hydration effect above has run by now") stopped being true when loadCloudProject was added.
- Proof: live: reload of /project/pmw1gbxb0 (1 screen, 19 objects, 7 tags) shows the pane: `document.body.innerText.includes("Whatarewebuilding") === true`. The same happened after sign-in → /tags → Workspace (flow 3).
- Users hit: every user who reloads or reopens a project, every time.
- Fix: decide `start` after hydration completes. Have useProjectHydration expose a `loaded` flag, or latch only once `useProject.getState().id === projectId`. Add a "Go to the canvas" escape on the pane.
- Last audit: new

### S4-22

**With Supabase Realtime on, server proposals and agent steps never reach the open tab**

- Status: open
- Severity: P1 broken flow
- Where: web/src/lib/collab/realtime.ts (no `proposal` or `agent` handler; only lib/collab/browser.ts:69-70 forwards them). Not my file; hit in the flow.
- Repro: as in S4-21, wait.
- Expected: the proposal card appears.
- Actual: nothing for 80 s. GET `/api/projects/<id>/proposals` shows it ready ("Build: 3 screens; 0 errors, 2 warnings left"). It appears only after a reload.
- Proof: live: flow 2 step 7; `grep -n "proposal\|agent" lib/collab/realtime.ts` → no matches.
- Users hit: every signed-in user who uses the Copilot.
- Fix: broadcast proposal and agent hints on the channel and fetch on receipt, or keep the SSE stream for those events. Needs no setting change.
- Last audit: new

### S1-02

**A binding rebuild rewrites bindings the engineer did not touch (CO target SubType, source PropertyFullName)**

- Status: open
- Severity: P1 broken flow. Whether OTE still resolves the rows is not verified.
- Where: web/src/lib/ote/bindings.ts:150-158 (`SubType: part.Type` writes "CompoundObject" for "CompoundObject.<Definition>") and bindings.ts:127-133 (Sources rebuilt without PropertyFullName). Triggered from web/src/lib/ote/packager.ts:575-603 on any change to wires, alarms or variables.
- Repro: open HMICopilot_Panel1.eote, delete one bound NumericDisplay, then export. Compare Bindings.dat.
- Expected: only the deleted part's rows change.
- Actual: 10 untouched rows get `Target.SubType CompoundObject.<definition> -> CompoundObject`, and 10 (Panel1) or 18 (auto-manual) variable sources lose `PropertyFullName: "Value"`. On HMICopilot_Drive_4.1.eote, 3 SubTypes change.
- Proof: web/scripts/audit/s1-eote-writer.test.ts (fails with "the untouched CO binding's target SubType: expected 'CompoundObject' to be 'CompoundObject.Def'"). Measured: fidelity.mts delete op on 5 bound types per file; fidelity-probe output.
- Users hit: importers whose project uses COs or carries PropertyFullName, on any delete of a bound part, any bindTag and any tag or alarm edit.
- Fix: keep each modelled wire's original Source/Target/Binding row when the wire is unchanged, and emit `CompoundObject.<Definition>` as SubType. This touches the .eote writer's output, so it needs Shaurya: "buildGraph keeps unchanged rows; SubType from productTree".
- Last audit: new

### S2-03

**The laptop store silently drops generation jobs**

- Status: open
- Severity: P1 (broken flow: MCP `generate` on a laptop/MCP Inspector returns a job id that `generation_status` can never find)
- Where: web/src/lib/server/storage.ts:132-143 (table allow-list without "generationJobs"); writes at web/src/lib/server/repo-jobs.ts:126,134,142,150,161
- Repro: `new FileRepo(dir)`; create a project; `jobs.create(...)`; `jobs.get(id)` -> null.
- Expected: the row persists like every other table.
- Actual: FileStorage only commits tables in its list (storage.ts:165), so the write is discarded without error. The comment at storage.ts:138-141 names exactly this hazard.
- Proof: web/scripts/audit/s2-filerepo-jobs.test.ts (fails with `FileRepo dropped the generationJobs row it just wrote: expected null to be '<uuid>'`). tests/mcp-generate.test.ts only uses MemoryRepo.
- Users hit: connector users testing locally (MCP Inspector), the shared localhost server (FileRepo at web/.data). Production (Mongo) unaffected. Flag to S3.
- Fix: add "generationJobs" to the list; better, derive the list from one exported constant that BaseRepo and the factories share, with a test that every table written is listed.
- Last audit: new

### S2-06

**/api/knowledge reads, adds and deletes with no identity and no Origin check**

- Status: open
- Severity set by the orchestrator: P1. S2 rated it P2 and S5 (as S5-05) rated it P0. It is a security hole with data loss (anonymous DELETE), so it is above P2, but production's knowledge store is off today, so it is latent there: P1 until a deployment turns the store on.
- Also reported as: S3-08, S5-05 (merged here)
- Severity: P2 (security: on a laptop any web page can POST a project into the retrieval corpus the model is fed, or DELETE records; on a deployment with KNOWLEDGE_STORE=mongo anyone can list customer tag conventions, poison or wipe them)
- Where: web/src/app/api/knowledge/route.ts:26-77; related: web/src/lib/knowledge/privacy.ts:6-9 lets anonymous imports feed a shared Mongo store
- Repro: `DELETE http://localhost:3000/api/knowledge?id=<sha>` with `Origin: https://attacker.invalid` and no cookie -> 200.
- Expected: 403 for a foreign Origin; on a deployment, a signed-in owner (or admin) only.
- Actual: deleted.
- Proof: web/scripts/audit/s2-knowledge-unguarded.test.ts (fails with `a foreign origin with no session deleted a knowledge record: expected { status: 200, deleted: [ 'abc' ] } to deeply equal { status: 403, deleted: [] }`). Prod: GET /api/knowledge -> `"store":"off"`, so production is not exposed today.
- Users hit: laptop users browsing other sites while the app runs; any deployment that turns the store on.
- Fix: `sameOrigin(request)` on POST/DELETE; on a deployment require a user and scope records to their owner.
- Last audit: AUDIT_2026-10 §6 (the "off by default" decision) still holds; the route guard is new.

## P2

### S1-09

**An op that names a screen edits the same-named object on another screen**

- Status: open
- Severity: P2 wrong output
- Where: web/src/core/ops/apply.ts:153-160 (`findPartByName` scans every screen and takes the first) via resolve at 376-383. `op.screen` is ignored for moveObject, resizeObject, setText, setColor, deleteObject and bindTag.
- Repro: two screens each holding a part with one name; `{op:"moveObject", screen:"Second", target:<name>, dx:30}`.
- Expected: the part on Second moves.
- Actual: the part on the first screen moves, and the op reports success.
- Proof: web/scripts/audit/s1-ops-concurrency.test.ts (fails with "Banner on screen Second ... the one on PumpStation1 moved instead: expected +0 to be 30"). Measured: HMICopilot_Panel1.eote and auto-manual.eote each have 7 part names used on more than one screen.
- Users hit: chat, agent and MCP users who address by name on multi-screen projects (headers repeat on every screen).
- Fix: when `op.screen` is set, resolve the name on that screen first, and reject an ambiguous name across screens.
- Last audit: new

### S2-08

**No security headers: pages can be framed, no CSP**

- Status: open
- Severity: P2 (security: clickjacking of /signin and of the connector consent page /oauth/authorize, where one click grants claude.ai access to the account; no defence in depth against XSS)
- Where: web/next.config.ts (no `headers()`), no web/src/middleware.ts
- Repro: `curl -sD - https://hmibuildtimecopilot.vercel.app/signin -o /dev/null`
- Expected: `Content-Security-Policy` with `frame-ancestors 'none'` (or `X-Frame-Options: DENY`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, no `X-Powered-By`.
- Actual: only `Strict-Transport-Security` (added by Vercel); `X-Powered-By: Next.js`; `/` also sends `Access-Control-Allow-Origin: *` (static page, Vercel default).
- Proof: prod (GET, read-only) headers for `/`, `/signin`, `/api/me` as above. The consent page itself needs a session to render; framing it is not verified on prod (no prod account). S3 to confirm the consent button is a plain form POST.
- Users hit: every user; connector users most.
- Fix: `headers()` in next.config.ts with frame-ancestors none and nosniff for all routes; `poweredByHeader: false`.
- Last audit: new

### S3-09

**tidyLayout, and the overlaps line the model is shown, cannot see overlaps inside a card**

- Status: open
- Severity: P2 (wrong output: "make this screen tidy" reports done and leaves visible overlaps)
- Where: web/src/lib/ote/tidy.ts `unitsOf` folds every part held by a Rectangle card into one unit, and `overlapsOn` compares units only. It is used by apply.ts:852 (tidyLayout) and by converse.ts digestOf ("Overlaps on it").
- Repro: the tracked sample demo_project/HMICopilot_Bars.eote, screen PumpStation1. Sym_TNK101 (940,92 52x52) covers Ind_TNK101LEVEL_2 (696,128 296x56).
- Expected: the overlap is found, so tidy fixes it or reports that it cannot.
- Actual: `overlapsOn` finds 0 overlaps on the screen. The live chat run of "make this screen tidy" left 3 card-internal overlaps (1240 px²) and reported success (F2).
- Proof: web/scripts/audit/s3-tidy-card-blind.test.ts (fails: "the symbol covers the indicator by 52x16 px (832 px²) and overlapsOn found 0 overlaps"). Measured: SCRATCH\s3\chat-3.json.
- Users hit: everyone who asks the chat to tidy a generated screen. The sample generator itself produced this overlap.
- Fix: in overlapsOn, also compare parts inside one unit (excluding the card itself and full containment), and either move the inner part within its card or report it as "inside <card>: needs the faceplate layout fixed". The full fix belongs to the layout solver (DESIGN_NESTED_CANVAS).
- Last audit: new

### S4-02

**History > Restore on the oldest of 20 versions does nothing, and logs "Restored version"**

- Status: open
- Severity: P2 wrong output
- Where: web/src/components/history/HistoryScreen.tsx:310-316; web/src/store/slices/collab.ts:381, 388-389
- Repro: take 20 versions, then click Restore on v1.
- Expected: the project returns to v1.
- Actual: snapshot("Before restore") pushes v1 out of the 20-slot list, so restore(at) finds nothing; the log and the navigation still claim success.
- Proof: web/scripts/audit/s4-history-restore-oldest.test.ts (fails with "restoring v1 of 20 left the 19 later objects on the screen: the version was dropped by the checkpoint taken first: expected 38 to be 19")
- Users hit: anyone with a long session (versions are taken on every build, edit turn and tag import).
- Fix: look up the version before checkpointing, or restore first and then insert the checkpoint, or exempt the target from truncation.
- Last audit: new

### S4-03

**A new project inherits the previous project's standards, including "Review every AI edit"**

- Status: open
- Severity: P2 wrong output
- Where: web/src/store/project.ts:536-567 (reset leaves `standards`); web/src/components/shell/useProjectHydration.ts:165-177 (the new-project hydrate sets none)
- Repro: in project A, turn on "Review every AI edit" and set grid 20. Click New project.
- Expected: defaults.
- Actual: the new project has review on and grid 20, and autosaves them.
- Proof: web/scripts/audit/s4-standards-leak-new-project.test.ts (fails with "reviewAiEdits leaked from the previous project into a new one: expected true to be false")
- Users hit: anyone who changes a setting and starts another project. The management-of-change switch silently follows them.
- Fix: reset() sets `standards = DEFAULT_STANDARDS` (and clears `preview`).
- Last audit: new

### S4-05

**Plant "Rebuild from tags" drops the ranges the engineer typed**

- Status: open
- Severity: P2 wrong output
- Where: web/src/components/plant/PlantScreen.tsx:305-306
- Repro: Plant → set a max on a reading → Rebuild from tags.
- Expected: the range is kept, as the button's title says.
- Actual: reset to the class default.
- Proof: web/scripts/audit/s4-plant-rebuild-drops-ranges.test.ts (fails with ""Rebuild from tags" promised to keep the range; FT_101_PV.max went from 4321 back to 100 (class)")
- Users hit: anyone correcting ranges.
- Fix: route the button through the keep-engineer logic in answerQuestion (slices/tags.ts:43-59), extracted as a store action `rebuildPlant()`.
- Last audit: new

### S4-07

**Undo after deleting a composite brings back loose parts; the composite is lost**

- Status: open
- Severity: P2 wrong output
- Where: web/src/store/state.ts:61-76 (EditSnapshot), web/src/store/internals.ts:22-45
- Repro: add an AnalogIndicator, delete it, Ctrl+Z.
- Expected: the indicator comes back as an indicator.
- Actual: the parts and the groupId come back; `composites[id]` stays deleted.
- Proof: web/scripts/audit/s4-undo-delete-composite.test.ts (fails with "the parts came back but the composite instance did not")
- Users hit: anyone undoing a delete of a generated indicator, tile or symbol (the generator registers composites).
- Fix: add `composites` (and `programs`) to EditSnapshot, editable_slice and restoreSlice.
- Last audit: new

### S4-12

**Standards "Correct tag names on import" toggle does nothing**

- Status: open
- Severity: P2 wrong output
- Where: web/src/components/standards/StandardsScreen.tsx:180-183
- Repro: turn it off; import a file with an illegal tag name.
- Expected: no correction.
- Actual: corrected anyway; `enforceNaming` is never read.
- Proof: measured: `grep -rn enforceNaming src tests scripts` → only StandardsScreen.tsx:181-182 and store/types.ts:91, 107.
- Users hit: anyone relying on the switch.
- Fix: send it to /api/tags/parse, or remove the toggle.
- Last audit: new

### S4-13

**Settings says "Nothing is uploaded" when files and projects are uploaded**

- Status: open
- Severity: P2 wrong output (a data-handling claim)
- Where: web/src/components/settings/SettingsScreen.tsx:112-114
- Repro: Settings → General → "This session".
- Expected: a true statement of where data goes.
- Actual: "The project lives in this browser tab. Nothing is uploaded; the only way out is the Export screen". Opened files go to /api/import and the knowledge scan; signed-in projects are saved on the server (persist.ts:198-229). "Clear the project" also has no confirm and is undone by a reload.
- Proof: measured: flow 1 network log `POST /api/import`; flow 2 `PUT /api/projects/<id>`.
- Users hit: anyone deciding whether client data may go in.
- Fix: rewrite the copy from the real store choice (/api/me cloud, knowledge store).
- Last audit: new

### S4-14

**Landing "Open an existing .eote" does the same as "Start a project"**

- Status: open
- Severity: P2 wrong output (dead end)
- Where: web/src/components/landing/StartButtons.tsx:655-670; Sections.tsx:595-600
- Repro: click it.
- Expected: a file picker.
- Actual: a new empty project with the start pane; the open action is a small underlined link.
- Proof: live: flow 1 step 1 (prod and local).
- Users hit: every brownfield first visit.
- Fix: pass an intent (`?open=1`) that the start pane turns into `filePicker.click()`.
- Last audit: new

### S4-15

**Projects page deletes a project in one click, with no confirm or undo**

- Status: open
- Severity: P2 (data loss of local work)
- Where: web/src/components/projects/ProjectsScreen.tsx:191-194, 357-365
- Repro: hover a card and click the bin.
- Expected: a confirm.
- Actual: the card and its localStorage contents are removed at once.
- Proof: code: `remove()` calls `clearProject(id)` directly on click.
- Users hit: anyone; device-only projects have no other copy.
- Fix: confirm, or soft-delete with undo.
- Last audit: new

### S4-19

**A read-only member's tab PUTs the whole project and then shows "Offline - saved on this device"**

- Status: open
- Severity: P2 wrong output
- Where: web/src/components/shell/useProjectHydration.ts:228-297 (autosave with no role check); web/src/store/persist.ts:209-259
- Repro: open a project as a commenter or viewer member.
- Expected: no save attempt; status "View only".
- Actual: `PUT /api/projects/<id> → 403`; the top bar says "Offline - saved on this device" (tooltip "You do not have permission for this action"). The device meta is marked dirty under the reviewer's id.
- Proof: live: flow 3 step 10, network `[PUT] /api/projects/pmw1gbxb0 => [403]`.
- Users hit: every commenter and viewer member.
- Fix: skip scheduleCloud when useAccess lacks "edit".
- Last audit: new

### S4-21

**Every server project is treated as shared, so a solo engineer's chat becomes a proposal "for an editor to accept"**

- Status: open
- Severity: P2 broken flow
- Where: web/src/components/chat/shared.ts:280-285
- Repro: sign in, start a project (it auto-saves to the server), confirm a brief.
- Expected: the build runs and lands as for a local project.
- Actual: "Building on the server. The result will appear as a proposal for an editor to accept." The engineer is the only member.
- Proof: live: flow 2 step 6.
- Users hit: every signed-in user.
- Fix: treat a project as shared only when it has more than one member, or another session is present; otherwise use the local commit path with a live session.
- Last audit: new

### S4-23

**The conversation is lost on reload in any server project**

- Status: open
- Severity: P2 (data loss of the chat and its version links)
- Where: web/src/store/persist.ts:169-179 (the whole-snapshot save stands down while live); web/src/lib/collab/changes.ts:60-95 (chat and versions are not change-log fields)
- Repro: in a signed-in project, send a chat turn, then reload.
- Expected: the thread is there.
- Actual: empty "Describe what you need…"; the request and the reply are gone.
- Proof: live: flow 2 step 8.
- Users hit: every signed-in user.
- Fix: include chat (and versions) in the change log, or keep saving those fields through the snapshot route.
- Last audit: new

### S5-01

**Paint order changed in the editor is lost on export for container-rooted screens**

- Status: open
- Severity: P2 wrong output
- Where: web/src/lib/ote/containers.ts:363-381 (mergeTree rebuild keeps original child order); reached from web/src/components/inspector/LayersPanel.tsx:68-76, CanvasToolbar.tsx:292-297, useCanvasShortcuts.ts:392-403
- Repro: open a Grid-rooted screen (every OTE-made screen), bring the first object to the front, export
- Expected: the exported Grid lists the object last (painted in front)
- Actual: the exported Grid keeps the original order
- Proof: web/scripts/audit/s5-layers-order-lost.test.ts (fails with "the exported Grid paints the ellipse last (in front): expected [ …(2) ] to deeply equal [ …(2) ]")
- Users hit: importers who restack on any of the 16 of 26 Grid-rooted engineer screens; every restack
- Fix: in `rebuild`, order each container's modelled leaves by their index in the flat list (unmodelled and container kids keep their slots). Touches the .eote writer's output: child order only, no format change
- Last audit: new

### S5-02

**Align and distribute take composites apart**

- Status: open
- Severity: P2 wrong output
- Where: web/src/store/slices/objects.ts:187-218, web/src/store/edits.ts:53-128; selection of a whole family at web/src/components/canvas/ScreenRenderer.tsx:522-529; buttons at CanvasToolbar.tsx:259-288; chat alignObjects at web/src/core/ops/apply.ts:907-909
- Repro: click one analogue indicator, shift-click another (each selects its 6 parts), press "Align left"
- Expected: each indicator moves as a unit
- Actual: every member of both lands on one x
- Proof: web/scripts/audit/s5-align-collapses-composite.test.ts (fails with "each composite keeps its members' layout: expected [ '0,0,0,0,0,0', '0,0,0,0,0,0' ] to deeply equal [ '0,8,8,64,168,252', …(1) ]")
- Users hit: everyone who aligns generated faceplates or indicators; chat "align the lamps" through select
- Fix: align and distribute over units (composite, card with contents, as tidy.ts moveSetOf builds them) and nudge each unit rigidly. Full fix in DESIGN_NESTED_CANVAS (solver)
- Last audit: new

### S5-04

**Generated screens overflow the 320x240 panel the app offers**

- Status: open
- Severity: P2 wrong output
- Where: web/src/lib/ote/layout.ts:284 (title 620 wide), :320 (footer label 500 wide), :116/:148 (card 162 tall from y=84); panel offered at web/src/lib/backend/panels.ts:33
- Repro: generate for HMISTU855
- Expected: every part inside 320x240
- Actual: 8 parts outside, on 3 screens
- Proof: web/scripts/audit/s5-small-panel-layout.test.ts (fails with "expected [ …(8) ] to deeply equal []" for HMISTU855 320x240; the other 4 panels pass)
- Users hit: anyone who picks HMISTU855 (rare)
- Fix: clamp chrome widths to the panel; compact card height below 640 wide
- Last audit: new

### S5-06

**Snap-to-grid never puts an off-grid object on the grid**

- Status: open
- Severity: P2 wrong output
- Where: web/src/components/canvas/ScreenRenderer.tsx:314-317, 354-355 (rounds the drag delta), vs 395-398 (resize rounds the position)
- Repro: snap on (default, store/types.ts:103); drag an object at Left 13 by about 20 px
- Expected: Left lands on a multiple of 8
- Actual: Left becomes 13+16=29
- Proof: measured: 450 of 577 (78%) parts in the engineer files are off the 8 px grid, so for them snap never reaches the grid. No DOM in the test env (no jsdom/happy-dom), so the gesture cannot be driven in a test
- Users hit: importers, every snapped drag
- Fix: snap `start + dx` and apply the difference
- Last audit: new

### S6-01

**Server rasteriser draws Line, PolyLine, Polygon, Bezier and Path strokes as hairlines**

- Status: open
- Severity: P2 wrong output
- Where: web/src/components/canvas/parts/Shapes.tsx:59, web/src/components/canvas/parts/GraphicObject.tsx:79 (rasterised by web/src/lib/critic/render.ts:72-85)
- Repro: render a screen with a Line part (Thickness 2, black, 100x40 box) through `screenToSvg`, then resvg.
- Expected: a 2 px dark line, as the editor draws it.
- Actual: the darkest pixel is 246/255. resvg ignores `vector-effect="non-scaling-stroke"` and scales the stroke by box/3072. Library symbols lose their outline the same way.
- Proof: web/scripts/audit/s6-server-render-strokes.test.ts (fails with "darkest pixel on a 2 px black line is 246/255: resvg ignored vector-effect="non-scaling-stroke" and drew a hairline")
- Users hit: every PNG the app makes:
  - the agent's `view_screen` (`lib/agent/tools.ts:615`);
  - the MCP screen render for claude.ai (`lib/mcp/read.ts:183`);
  - the vision critic (`lib/critic/critic.ts:220`, `app/api/critique/route.ts:41`).
  - Worst on imported engineer screens, which use Line, Polygon and Path.
- Fix: map the 3072-unit points into the part's box in code, and draw a plain path with no nested viewBox
  stretch. The stroke is then right in browser and resvg alike. Renderer only, no writer change.
- Last audit: new

### S1-04

**Deleting a part leaves binding rows that target it**

- Status: open
- Severity: P2 wrong output
- Where: web/src/lib/ote/packager.ts:575-576. Bindings.dat is rewritten only when the modelled wires change, and even then appendExtra (377-405) re-appends every carried row, including those whose target part is gone. Carried rows come from web/src/lib/ote/reader.ts:630-642.
- Repro: delete an AlarmSummary on HMICopilot_Panel1.eote (its binding is not a modelled wire), then export.
- Expected: no row targets the deleted object.
- Actual: 1 dangling row per master-screen file. The CO_FORMAT invariant "every part a Target names is in the tree" is broken.
- Proof: web/scripts/audit/s1-eote-writer.test.ts (fails with "binding rows still targeting the deleted part: expected 1 to be +0"). Measured: fidelity.mts delete AlarmSummary on 3 files.
- Users hit: importers deleting objects with unmodelled bindings (expression converters, non-variable sources). There are 302-330 such rows per engineer file.
- Fix: when writing, drop extra Targets of ObjectType 8 (and their bindings and orphaned sources) whose ObjectId is in no screen or content tree. This changes writer output, so needs Shaurya.
- Last audit: new

### S1-10

**A MasterScreen is not modelled: every screen of the project is shown without its frame**

- Status: open
- Severity: P2 wrong output
- Where: web/src/lib/ote/schema.ts:889-891 (`Type: z.enum(["Screen","Content"])`) and web/src/lib/ote/reader.ts:436-441 (carried, with the warning "1 screen could not be modelled (root: 1 Grid)", which names the root, not the cause)
- Repro: open HMICopilot_Panel1.eote or auto-manual.eote.
- Expected: the master screen (header, icons, title, clock) is drawn behind the screens under it and can be edited.
- Actual: it is not in the editor or in render_screen. 6 objects are invisible (3 Path, 1 TextBox, 1 DateTimeDisplay, 1 ContentDisplay). The file keeps them byte-identical.
- Proof: measured by fidelity.mts. Panel1 carriedScreens `Screens:MasterScreen/Grid: 1`; DateTimeDisplay read 0 %, Path 71.4 %, ContentDisplay 80 %. The parse error is `Invalid enum value. Expected 'Screen' | 'Content', received 'MasterScreen'`.
- Users hit: importers of any project that uses master screens. These are the 2 master-screen engineer files. This is the likeliest match for "panels throw errors when read".
- Fix: accept MasterScreen in Screen.Type, keep its header keys, model it, and draw it under the screens of its branch. A safe read (draw only) is enough for Stage 2.
- Last audit: new

### S1-12

**Variables of TIME, USINT and Machine Expert structured or FB types are not modelled**

- Status: open
- Severity: P2 wrong output (partly supported)
- Where: web/src/lib/ote/schema.ts:946-957 (DATA_TYPES) and web/src/lib/ote/reader.ts:531-534 (row skipped)
- Repro: open any of the 4 engineer files.
- Expected: all 162 variables are listed and bindable.
- Actual: 120 are modelled. 42 are carried and cannot be seen or bound in the app: TIME 22, USINT 1, Machine Expert structured or FB types 19.
- Proof: measured by fidelity.mts (inventory.variables.byDataType)
- Users hit: importers of Machine Expert projects.
- Fix: add TIME, USINT, SINT, LINT, ULINT, BYTE and DATE_AND_TIME to DATA_TYPES, and model structured variables read-only by their type name.
- Last audit: new

### S2-12

**Snapshots between 16 MB and 64 MB are accepted and then fail to save on Mongo**

- Status: open
- Severity: P2 (large imported plants cannot be saved to the server; the user sees "Server storage is unavailable")
- Where: web/src/lib/server/snapshot.ts:9 and web/src/lib/client/snapshot.ts:216 (64 MiB cap) vs single-document writes web/src/lib/server/repo.ts:194-196 (versions), web/src/lib/server/repo-live.ts:139-140 (heads), web/src/lib/server/storage.ts:185 (`replaceOne`)
- Repro: PUT a 20 MB snapshot to a Mongo-backed deployment.
- Expected: either a 413 that says the limit, or snapshots stored in GridFS.
- Actual: Mongo rejects a document over 16,777,216 bytes; errorResponse maps it to 500 `internal` (errors.ts:17).
- Proof: measured: BSON maximum document size 16 MiB vs code cap 64 MiB (67,108,864 bytes); lib/ote/imports.ts:103-108 already refuses >15 MB imports for this reason. Not run against Mongo (production DB is off limits).
- Users hit: importers of large projects on the deployment.
- Fix: cap at 15 MB with a clear 413 now; store snapshot bodies in GridFS later (needs a storage design, no Vercel/Mongo setting).
- Last audit: new

### S2-13

**Size limits on whole-body routes are unreachable on Vercel**

- Status: open
- Severity: P2 (wrong output: a 5-16 MB tag export, a >4.5 MB Vijeo backup or a >4.5 MB project for "import screens" fails on production with Vercel's own 413, not the app's message)
- Where: web/src/app/api/tags/parse/route.ts:18,21-35; web/src/app/api/vijeo/migrate/route.ts:29-32; web/src/app/api/import/screens/route.ts:27; callers post whole files: web/src/components/tags/useTagImport.ts:239, web/src/components/shell/StartPane.tsx:224, web/src/components/canvas/ImportScreensDialog.tsx:43. Also `request.formData()` buffers the whole body before the size check (tags/parse:21, vijeo/migrate:29), so off Vercel the check protects nothing.
- Repro: upload a 6 MB tag CSV on production.
- Expected: the chunked upload path (lib/client/upload.ts) or an honest 4 MB limit in the message.
- Actual: Vercel rejects the request body above 4.5 MB before the function runs.
- Proof: code; the platform ceiling is the one lib/client/upload.ts:1-5 and lib/client/snapshot.ts:215 already design around. Not verified on prod (POST not allowed).
- Users hit: importers with large tag lists or Vijeo backups.
- Fix: route these through /api/upload parts and pass `uploadId`, as /api/import does.
- Last audit: new

### S1-07

**Two clients adding objects at the same time get the same handle**

- Status: open
- Severity: P2 wrong output (a later op by handle resolves to the wrong object)
- Where: web/src/store/internals.ts:63-66 and web/src/store/slices/objects.ts:67 (`o${++handleSeq}` from the local seq), synced verbatim by web/src/lib/collab/changes.ts:613-621. Nothing reconciles it in web/src/lib/server/repo-live.ts:99-135 or lib/collab/sync.ts rebase.
- Repro: two editors on one shared project each add a part before seeing the other's.
- Expected: handles stay unique.
- Actual: both parts are `o21`. apply.ts:138-140 and 378-380 then take the first match.
- Proof: web/scripts/audit/s1-ops-concurrency.test.ts (fails with "handles held by two objects after both edits landed: expected [ 'o21' ] to deeply equal []")
- Users hit: sharers co-editing, and the Copilot/agent working while an editor adds parts.
- Fix: allocate handles on the server at append (or namespace them per author), or re-handle on rebase when a handle value is already taken.
- Last audit: new

### S1-08

**Concurrent edits to different properties of one part: one is lost, and no base check reports it**

- Status: open
- Severity: P2 wrong output (documented design, real lost update)
- Where: web/src/lib/server/repo-live.ts:99-135 (applies in arrival order; `change.base` is never compared) and web/src/lib/collab/changes.ts:637-643 (setPart replaces the whole part)
- Repro: A renames a TextBox's text while B moves it, both from the same revision.
- Expected: both edits, or a conflict B is told about.
- Actual: B's stale whole part overwrites A's text, and both changes are "accepted".
- Proof: web/scripts/audit/s1-ops-concurrency.test.ts (fails with "A's text, overwritten by B's whole-part setPart: expected 'Pump Station 1' to be 'RENAMED'")
- Users hit: sharers co-editing the same object. The Copilot accepting an agent-run proposal with fixed groups (proposals.ts:141-142) does the same over any part it touched.
- Fix: send property-level patches for setPart, or reject or rebase a setPart whose part changed after `base`.
- Last audit: new

### S2-05

**Anyone can lock any account out of sign-in**

- Status: open
- Severity: P2 (security: targeted denial of service; 11 requests per 15 minutes keep a named engineer out indefinitely)
- Where: web/src/lib/server/credentials.ts:119-120 (both limits counted before the password is checked), web/src/lib/server/rate-limit.ts:98-105
- Repro: 10 wrong passwords for victim@... from any IP; the victim then types the right password from their own IP.
- Expected: the owner gets in (e.g. count failures per email+IP, or let a correct password through the email bucket).
- Actual: 429 "Too many attempts" for 15 minutes; Auth.js turns it into a refusal the form words as "do not match an account".
- Proof: web/scripts/audit/s2-signin-lockout-dos.test.ts (fails with `the owner was locked out by someone else's guesses: expected 'refused 429: Too many attempts. Try a...' to be 'signed in'`); local: s2-b signed up, 10 wrong passwords from 10.22.1.1-10 (each -> `?error=CredentialsSignin`), then the right password from 10.22.2.1 -> redirect to `/api/auth/error?error=Configuration` and /api/me user null. Auth.js also files the 429 as a server "Configuration" error rather than a sign-in refusal.
- Users hit: rare, but any named user an attacker picks; also the connector's authorize flow, which calls the same verifyPassword.
- Fix: key the email counter on (emailKey, ip) and keep a much higher global per-email ceiling; or check the password first and only count failures (bcrypt cost already slows guessing). Keep the equal-time refusal.
- Last audit: new

### S2-10

**Any member, including a viewer who joined by link, gets every member's email address**

- Status: open
- Severity: P2 (privacy: a viewer link forwarded around a plant hands out the owner's and editors' addresses)
- Where: web/src/app/api/projects/[id]/members/route.ts:15-27 (`email: user?.email`)
- Repro: sign in, open a viewer link (becomes viewer member), GET /api/projects/<id>/members.
- Expected: emails only for the owner (who manages membership), names for everyone else.
- Actual: all emails.
- Proof: web/scripts/audit/s2-access-leaks.test.ts (fails with `a viewer read the owner's email address: expected [ 'owner@plant.example' ] to deeply equal []`).
- Users hit: sharers.
- Fix: include `email` only when the caller can `manage`.
- Last audit: new

### S2-15

**Sign-out does not end a session; a copied cookie works for 30 days**

- Status: open
- Severity: P2 (security: a session cookie lifted from a shared plant PC stays valid after "Sign out"; there is no way to revoke it, change the password, or sign out everywhere)
- Where: web/src/auth.ts:25 (`session: { strategy: "jwt" }`, no maxAge, no adapter); Auth.js default maxAge 30 days (node_modules/@auth/core/lib/init.js:38)
- Repro: sign in, copy `authjs.session-token`, sign out, replay the cookie on GET /api/me.
- Expected: sign-out (or a password change) invalidates the session server-side.
- Actual: by construction the JWT is valid until it expires; nothing is stored to revoke.
- Proof: local (production build): signed in as s2-a (cookie `authjs.session-token`, Expires 30 days ahead, HttpOnly, SameSite=Lax), copied the cookie, POST /api/auth/signout -> `Max-Age=0`; /api/me with the cleared jar -> user null; /api/me replaying the copied cookie -> the s2-a user again. Code: auth.ts:25; Auth.js default maxAge 2,592,000 s (node_modules/@auth/core/lib/init.js:38).
- Users hit: all signed-in users, on shared machines.
- Fix: a `sessionVersion` on the user row checked in the `jwt` callback (bumped on sign-out-everywhere and password change), and a shorter maxAge (e.g. 8 h) for a plant tool.
- Last audit: new

### S3-05

**The token endpoint does not bind codes and refresh tokens to the client**

- Status: open
- Severity: P2 (a security weakening against OAuth 2.1 MUSTs. PKCE still protects the code, and the refresh token is a bearer secret, so the practical exposure is narrow.)
- Where: web/src/lib/server/oauth.ts:540-543 (`if (clientId && clientId !== code.clientId)`) and oauth.ts:558-576 (refreshGrant never reads `client_id`).
- Repro: exchange a code with no `client_id`; or refresh client A's refresh token sending client B's `client_id`.
- Expected: `invalid_request` / `invalid_grant` (OAuth 2.1 §4.1.3: "if the client is public, ensure that the code was issued to client_id in the request"; §4.3: "MUST maintain the binding between a refresh token and the client").
- Actual: tokens are issued both times.
- Proof: web/scripts/audit/s3-oauth-client-binding.test.ts (fails with "a public client's code was exchanged with no client_id at all" and "client B refreshed client A's refresh token and got new tokens"). Live on localhost: SCRATCH\s3\oauth-flow.sh step 12 ("issued to the other client_id? true") and step 15 ("issued without client_id? true").
- Users hit: connector users (none affected in normal use).
- Fix: require `client_id` on both grants and compare it with `code.clientId` and `grant.clientId`. That changes the OAuth wire contract for non-compliant clients, so it **needs Shaurya**. Claude sends `client_id` (RFC 6749 public client), so Claude is unaffected.
- Last audit: new

### S3-06

**MCP generate takes a brief with an unbounded unit count**

- Status: open
- Severity: P2 (a cost and memory problem: a model call and a pipeline run are paid for before the refusal, and the placeholder tags are built in memory)
- Where:
  - web/src/lib/mcp/generate.ts:111 `count: z.number().int().optional()`;
  - web/src/lib/brief/brief.ts:57 and brief.ts:124-128 (`problemsWith` has no upper bound);
  - the MAX_BUILD_OPS check at generate.ts:289 runs only after `runPipelineInto`, which makes the model call.
  The model and rules paths cap the count at 20 (web/src/lib/brief/draft.ts MAX_COUNT).
- Repro: call MCP `generate` with `brief.units[0].count = 10000000`.
- Expected: the gate refuses a count above the drafting cap (20) before a job starts.
- Actual: `problemsWith` returns no problem. `tagsFromBrief` at count 200,000 built **800,000 variables in 1045 ms** (measured); 10M would be 40M objects.
- Proof: web/scripts/audit/s3-brief-count.test.ts (fails: "problemsWith accepts count 10,000,000"; "count 200000 produced 800000 placeholder tags in 1045 ms").
- Users hit: connector users, rarely. Only a client that sends the brief directly.
- Fix: `.max(MAX_COUNT)` on the zod `count` (generate.ts and brief.ts Unit), plus a `problemsWith` check. Estimate the op count from the brief before starting the job.
- Last audit: new

### S1-11

**setColor and setText report success with no visible change on several types**

- Status: open
- Severity: P2 wrong output
- Where: web/src/core/ops/apply.ts:766-767 (setColor always writes the top-level `Fill.Color.Value`) and web/src/core/ops/apply.ts:730-731 (setText on a two-face part writes the On or Press face only)
- Repro: setColor red on a Lamp, ToggleSwitch, Switch, CompoundObject, TextBox or AlarmSummary; setText on a Lamp or ToggleSwitch.
- Expected: the change shows, or the op is refused with a reason.
- Actual: "Set ... fill to red" or "Relabelled ...", and the drawing is unchanged.
- Proof: measured by fidelity.mts. Applied but not visible: setColor TextBox 11, AlarmSummary 9, Lamp 6, ToggleSwitch 5, CompoundObject 4, Switch 2; setText Lamp 6, ToggleSwitch 5, Switch 2.
- Users hit: chat, agent and MCP users restyling objects.
- Fix: colour the faces on stateful parts and the definition's exposed colour on a CO, and check the drawn result before saying "done". Refuse it otherwise.
- Last audit: new

### S3-03

**alignObjects silently drops targets it cannot find, and reports a no-op spread as done**

- Status: open
- Severity: P2 (wrong output: an object jumps to the screen edge, or nothing moves, and the engineer is told it worked)
- Where: web/src/core/ops/apply.ts:879-881 drops unresolved names without a word; it rejects only when *none* resolve (apply.ts:882). Then:
  - with one object left, web/src/store/edits.ts:61-64 aligns it to the screen frame;
  - with two objects, `spread`, web/src/store/slices/objects.ts:208 returns early when fewer than 3.
  Either way the op answers `ok(note || "Aligned N objects")` (apply.ts:911).
- Repro: `applyOps([{op:"alignObjects", targets:[<real part>, "Btn_Stop_Missing"], mode:"left"}])`. Or `mode:"spreadHorizontal"` with two targets.
- Expected: the unresolved name is rejected with candidates (as `moveObject` does via `unresolved`), the object is not moved to the edge, and a 2-object spread is refused.
- Actual: `applied=["align the start and stop buttons"] rejected=[]`, and the part's left went **700 -> 0**. The spread answered `applied=["spread them"]` and nothing moved.
- Proof: web/scripts/audit/s3-align-partial.test.ts (2 of 2 fail with the messages above).
- Users hit: chat and MCP users who ask to align, whenever the model misnames one handle. Common on flash-lite.
- Fix: in apply.ts alignObjects, reject each unresolved target with `unresolved(s, name)`. Refuse when fewer than 2 resolve for align and fewer than 3 for spread, and say why.
- Last audit: new

### S4-06

**Variables.csv exports placeholder tags that the .eote leaves out**

- Status: open
- Severity: P2 wrong output
- Where: web/src/components/export/useExport.ts:129-131
- Repro: a screens-first project (confirmed brief, no real export) → Export → Generate files.
- Expected: the CSV matches the .eote (no variables), or carries a clear "placeholders" name.
- Actual: the CSV lists every invented tag, under a README saying it is a copy of the .eote's list.
- Proof: web/scripts/audit/s4-variables-csv-placeholders.test.ts (fails with "the CSV carries 1 placeholder tag(s) the .eote does not")
- Users hit: screens-first users who hand the CSV to the PLC programmer.
- Fix: use `packageInputOf(s).variables` for the CSV, or name it Placeholder_Variables.csv with a README line.
- Last audit: new

### S4-08

**Restoring a version drops locks, groups, provenance keys and bind intents**

- Status: open
- Severity: P2 wrong output
- Where: web/src/store/types.ts:117-125 (Version), web/src/store/slices/collab.ts:364-401
- Repro: lock a generated object, save a checkpoint, delete it, restore.
- Expected: it returns locked, with its regeneration key.
- Actual: it returns with no objectMeta.
- Proof: web/scripts/audit/s4-restore-drops-meta.test.ts (fails with "the restored object lost its regeneration key: expected undefined to be 'Card_PMP101'")
- Users hit: History and "revert to here" users. Regeneration then treats the object as unknown.
- Fix: snapshot objectMeta, composites and programs in Version, and restore them.
- Last audit: new

### S4-25

**The brief's "Alarms" screen is not built**

- Status: open
- Severity: P2 wrong output
- Where: the generator path from requestFromBrief (lib/brief) to the pipeline. Not my file; hit in the flow.
- Repro: brief with Overview, One per unit group and Alarms all on → Confirm and build.
- Expected: an alarm screen.
- Actual: PlantOverview, Pump101Group, Pump102Group; no alarm screen and no tank screen.
- Proof: live: flow 2 step 10.
- Users hit: screens-first users.
- Fix: pass brief.screens to the planner as hard requirements (S5/S1 to confirm where).
- Last audit: new

### S6-04

**A level 2 card's equipment symbol overlaps its first analogue indicator**

- Status: open
- Severity: P2 wrong output
- Where: web/src/lib/ote/layout.ts:454 (symbol at y+8, 52 px tall) vs web/src/lib/ote/layout.ts:511 (first indicator row at y+40 when the unit has no run or fault lamp)
- Repro: `buildFromTags` on samples/tank-farm/tags.csv ("tank farm overview"), then `critiqueGeometry` on each screen. Needs the gitignored graphics index, so that units carry a symbol.
- Expected: no overlap.
- Actual: the symbol overlaps the indicator frame by 52x16 px, and the value box and unit by 4x12 and 36x10 px.
  This happens on 9 of 36 sample screens; those screens score 1.0-1.8 of 5 on the geometric critic.
- Proof: web/scripts/audit/s6-card-symbol-overlap.test.ts (fails with "18 symbol/indicator overlaps, e.g. "Sym_X overlaps Ind_XX by 52x16px; one of them is unreadable."")
- Users hit: generators whose units have readings but no run or fault BOOL (tanks, valves, instruments), on
  machines with the symbol library indexed.
- Fix: start the readings below the symbol: `rowTop = y + max(run || fault ? 86 : 40, 8 + symbolSize + 4)`, or
  narrow the first row by the symbol's width. Full fix: design B's components own their boxes.
- Last audit: new

### S3-02

**The agent can delete the project's core files: delete_path on a folder or "", and run_script ws.delete**

- Status: open
- Severity: P2 (wrong output: the agent saves a project that does not open. The opened file is not changed, because /api/agent stores the result as a new source.)
- Where: web/src/lib/agent/tools.ts:275-280 tests `CORE` only against the path it was given, then deletes everything `ws.list(p)` returns. `delete_path {path:""}` lists every file. web/src/lib/agent/script.ts:241 (`host.delete`) never consults CORE. Compare docs/AGENT_WORKSPACE.md:42: "Core files ... cannot be deleted".
- Repro: `runAgentTool(ctx, "delete_path", {path: ""})`, or `{path: "Screens"}`, or `run_script` with `ws.delete("Project.dat")`.
- Expected: core files are kept, as they are when they are named one at a time (tools.ts:275) and as the shell keeps them (sandbox.ts:164).
- Actual: `delete_path ""` answered "deleted 6 files" and removed Project.dat, Bindings.dat, Screens/Hierarchy.dat and Screen.dat. `"Screens"` removed Hierarchy.dat and Screen.dat. `run_script` answered "ok" and Project.dat was gone.
- Proof: web/scripts/audit/s3-agent-core-delete.test.ts. 3 of its 4 tests fail with the messages quoted above.
- Users hit: Agent-tab users, rarely. It needs the model to delete a folder, or a prompt-injected instruction.
- Fix: filter `under` through `!CORE.test(f)` in delete_path, and refuse when what is left would empty a screen folder. Apply the same CORE predicate in script.ts host.delete. One shared helper in tools.ts would cover both.
- Last audit: new

### S3-07

**The agent's regex tools block the event loop on a catastrophic pattern**

- Status: open
- Severity: P2 (availability: one tool call freezes the function instance; the run's AbortSignal cannot stop it)
- Where: web/src/lib/agent/tools.ts:104-111 `pattern()` compiles any model-supplied regex. It is run synchronously over every line in `search` (tools.ts:172-174), and also in `find_objects`, `bindings` and `tags`.
- Repro: `search {pattern: "(a+)+$"}` over a file with a line of 26 `a`s and a `!`.
- Expected: it returns quickly, or refuses the pattern.
- Actual: **7096 ms** for one 27-character line, and each extra `a` doubles it.
- Proof: web/scripts/audit/s3-agent-redos.test.ts (fails with "one search call blocked the event loop for 7096 ms").
- Users hit: Agent-tab users, rarely. The pattern can come from a confused model or from project text it read.
- Fix: escape the pattern into a literal unless it passes a safe-regex check, or run the match with a time budget (for example in the QuickJS sandbox, which already has a deadline).
- Last audit: new

## P3

### S0-01

**A stale local build breaks `tsc --noEmit`**

- Status: open
- Severity: P3
- Where: web/tsconfig.json:36 (`".next-build/types/**/*.ts"` in `include`)
- Repro: build once with `NEXT_DIST_DIR=.next-build npx next build`, delete or rename a route (here `api/tags/draft` was removed after a build of 2026-10-22), then run `npx tsc --noEmit`.
- Expected: tsc checks the source and passes.
- Actual: 3 errors, all `TS2307: Cannot find module '../../../../../../src/app/api/tags/draft/route.js'` from `.next-build/types/app/api/tags/draft/route.ts` and `.next-build/types/validator.ts`. The same tree with `.next-build` excluded: 0 errors.
- Proof: measured on this machine at baseline (3 errors with the stale dir, 0 without it).
- Users hit: every developer who used the documented `NEXT_DIST_DIR=.next-build` build (next.config.ts:16) and later changes routes.
- Fix: drop `.next-build/types/**/*.ts` from `include` (Next only needs the dist dir it is running), or document cleaning it.
- Last audit: new

### S4-09

**Form labels are not tied to their inputs (sign-in, settings, share)**

- Status: open
- Severity: P3 cosmetic (accessibility)
- Where: web/src/components/ui/Field.tsx (label htmlFor={id}; the id is never given to the child)
- Repro: open /signin with a screen reader, or read the accessibility tree.
- Expected: "Email" and "Password" name their textboxes.
- Actual: unnamed textboxes. Live prod /signin snapshot: `textbox [ref=f1e17]` with no name. `input.labels.length === 0` locally.
- Proof: web/scripts/audit/s4-signin-labels.test.ts (fails with "labels point at ids no input has: _R_1_, _R_2_")
- Users hit: assistive-technology users; every Field in the app.
- Fix: Field passes `id` to its child via cloneElement, or callers pass `id`.
- Last audit: new

### S4-30

**The Projects card loses "Opened <file>" on the first autosave**

- Status: open
- Severity: P3
- Where: web/src/components/shell/useProjectHydration.ts:275-287 (touchProject `intent` from chat), overwriting StartPane.tsx:297-309 and ProjectsScreen.tsx:147-167
- Repro: open a file from the start pane, then look at its card.
- Expected: "Opened X.eote — carrying …".
- Actual: no intent line.
- Proof: live: flow 1 step 6.
- Users hit: every opened file.
- Fix: only overwrite intent when the chat has a user turn.
- Last audit: new

Bug count: P0 0, P1 3 (S4-01, S4-22, S4-24), P2 14 (S4-02, 03, 05, 06, 07, 08, 12, 13, 14, 15, 19, 21, 23, 25), P3 13 (S4-04, 09, 10, 11, 16, 17, 18, 20, 26, 27, 28, 29, 30). Total 30. S4-22, S4-24 and S4-25 sit in files outside my list (lib/collab, the proposals route, the generator) and were hit in the flows.

### S5-07

**Inspector geometry fields commit on every keystroke, through 0**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/components/inspector/Inspector.tsx:310-322; each call is a setBox with its own undo step (web/src/store/slices/objects.ts:111-122, `remember` at store/internals.ts:48-52); LocationEditor web/src/components/inspector/editors.tsx:144 same; Location repeated in the General group (schemaFields.ts:449)
- Repro: select an object, clear X and type 320
- Expected: one move to 320, one undo step
- Actual: moves to 0, 3, 32, 320; 4 undo steps (and 4 collab changes in a shared project); clearing W shrinks it to 1 px
- Proof: code. BindingEditor.tsx:133-137 commits on blur for exactly this reason
- Users hit: everyone who types a coordinate
- Fix: commit on blur/Enter; drop Location/Width/Height from the General group
- Last audit: new

### S6-03

**Every generated bar is drawn empty on the canvas and in the PNG**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/lib/ote/parts.ts:89,116 (writes 0), web/src/components/canvas/parts/BasicParts.tsx:45 (draws the 0)
- Repro: generate any sample (`buildFromTags`) and render it.
- Expected: a design-time bar the renderer's own rule calls readable (half full, `BasicParts.tsx:14-15`).
- Actual: an empty white trough with a black band frame on it.
- Proof: measured: 82 bars with fill 0 on 36 pipeline screens (web/scripts/audit/s6-render.mts, metrics.json `emptyBars`).
- Users hit: all users who generate screens (every AnalogIndicator).
- Fix: write the band's middle (or 50) as the design value in `fillBar` and `rectangle({ fillLevel })`. The
  binding replaces it at runtime. This changes a value the `.eote` writer emits, not its format: confirm with
  Shaurya.
- Last audit: new

### S1-13

**Resizing or deleting a ContentDisplay: the editor keeps the old layout of the content it shows**

- Status: open
- Severity: P3 cosmetic (the file is right, the canvas is not)
- Where: web/src/lib/ote/reader.ts:192-197 and 434-435 (content laid out at the display's size only at read)
- Repro: resize a ContentDisplay on HMICopilot_Panel1.eote, export, then reopen.
- Expected: the canvas shows what the file will show.
- Actual: 10 content parts land elsewhere on reopen.
- Proof: measured by fidelity.mts (resize and delete ContentDisplay: 10 boxes differ on each master-screen file)
- Users hit: importers of template-style projects.
- Fix: re-lay the shown content in the store when the display's size changes.
- Last audit: new

### S1-14

**HMIST6600 (1280x800), the panel of every engineer file, is not in the panel list**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/lib/backend/panels.ts:207-213
- Repro: open any engineer file and look at the target picker.
- Expected: the opened panel is listed.
- Actual: `panelFromValue` marks it provisional (panels.ts:232-242), and a new project cannot target it.
- Proof: measured by fidelity.mts. Target.dat in 4/4 engineer files says HMIST6600 1280 x 800.
- Users hit: importers.
- Fix: add the row after checking it against OTE's Models-*.xml.
- Last audit: new

### S5-03

**The board scrolls a double-click zoom to the wrong place when screens differ in size**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/components/canvas/CanvasPane.tsx:185, 289-297, 364-376 vs web/src/components/canvas/ScreenBoard.tsx:227-239
- Repro: a project whose screens differ in size (content screens); make a content screen live; double-click another frame
- Expected: the view scrolls to the frame
- Actual: it scrolls by a grid sized from the active screen (frame 2 drawn at y=1036, aimed at y=633.5)
- Proof: web/scripts/audit/s5-board-placement.test.ts (fails with "frame 2 is drawn at 0,1036: expected { x: +0, y: 633.5 } to deeply equal { x: +0, y: 1036 }")
- Users hit: importers of projects with content screens (8 of 26 engineer screens differ in size from the first)
- Fix: one boardLayout(screens) used by both, with per-frame sizes
- Last audit: new

### S6-02

**Server PNG has a transparent background where no part covers the screen**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/components/canvas/StaticScreen.tsx:107 (`style={{ background: PAPER }}`)
- Repro: `screenToSvg` of an empty screen, rendered by resvg; read the alpha of the centre pixel.
- Expected: alpha 255, paper #f1f1f1.
- Actual: alpha 0. 17 % of the pump-station fixture's PNG is transparent black. A vision model may see it as
  black or as white.
- Proof: web/scripts/audit/s6-server-render-strokes.test.ts (fails with "the centre of an empty screen has alpha 0: the paper is a CSS background resvg does not paint")
- Users hit: screens with no full-screen ground Rectangle: imported screens and the fixture. Generated screens
  draw a Ground rectangle.
- Fix: draw `<rect width height fill={PAPER}/>` as the first child instead of the CSS background.
- Last audit: new

### S6-05

**Rectangle CornerRadius is carried but never drawn**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/components/canvas/parts/BasicParts.tsx:31-38 (plain `<rect>`, no rx/ry)
- Repro: open any engineer project with a rounded rectangle, e.g. `HMICopilot_Panel1.eote`, which has 1 `CornerRadius`. Shipped sample: `reference/part_examples.json` Rectangle corpus, `CornerRadius {Style: 2, TopLeft..BottomRight: 5}`.
- Expected: rounded corners as OTE draws them.
- Actual: square corners.
- Proof: measured: 1 `CornerRadius` in each of `HMICopilot_Panel1.eote`, `Motor_Drive_Control_4.1.eote`, `HMICopilot_Drive_4.1.eote`, `auto&manua.eote` and `auto-manual.eote`; 0 rx in 1,791 `<rect>` drawn by the renderer over 38 screens.
- Users hit: importers, rarely (one per engineer project).
- Fix: read `CornerRadius` (pass-through today) and set `rx`/`ry`, which is per corner when the four differ (draw a path).
- Last audit: new

### S4-18

**Commenter and editor links get "Allow export" switched on by default**

- Status: open
- Severity: P3
- Where: web/src/components/shell/ShareDialog.tsx:391
- Repro: Share → Role Commenter.
- Expected: export stays off unless asked for.
- Actual: the toggle flips on; the link reads "Commenter · can export".
- Proof: live: flow 3 step 3.
- Users hit: sharers; a reviewer receives the client's file.
- Fix: keep the toggle off for every role.
- Last audit: new

### S4-20

**History, Plant, Standards, Settings and Templates check no role**

- Status: open
- Severity: P3
- Where: HistoryScreen.tsx:326-335, PlantScreen.tsx (no useCanEdit), StandardsScreen.tsx, SettingsScreen.tsx, TemplatesScreen.tsx:198-207
- Repro: as a commenter, open History.
- Expected: no "Save a checkpoint" or "Restore"; no editors.
- Actual: enabled.
- Proof: live: flow 3 step 14 (`checkpoint=true` for a commenter).
- Users hit: share-link members. The local change then fails to save (S4-19).
- Fix: gate them with useCanEdit like ChatPanel and TagImport.
- Last audit: new

### S1-15

**Two skip conditions hard-code Shaurya's home folder**

- Status: open
- Severity: P3 cosmetic (lost coverage)
- Where: web/tests/struct.test.ts:187 and web/tests/contents.test.ts:140 (`C:/Users/shaur/Downloads/EOTE_Template_v7`)
- Repro: run them on any other machine.
- Expected: the tests find the template pack where its owner put it.
- Actual: they always skip (3 of the 24 baseline skips).
- Proof: measured: baseline-vitest.txt.
- Users hit: developers. The 95-template breadth test never runs outside one laptop.
- Fix: `process.env.OTE_TEMPLATES ?? join(homedir(), "Downloads", "EOTE_Template_v7")`.
- Last audit: new

### S2-14

**The per-IP sign-in limit trusts a client-supplied X-Forwarded-For**

- Status: open
- Severity: P3 (off Vercel, any client picks its own bucket, so the 50-per-IP cap against password spraying is void; on Vercel the platform sets the header)
- Where: web/src/lib/server/rate-limit.ts:78-81
- Repro: two POST /api/signup to http://localhost:3000 with `X-Forwarded-For: 10.22.0.1`.
- Expected: the socket address, or the header only behind a trusted proxy.
- Actual: the counter key is the header value.
- Proof: local: after my two requests, web/.data/signInAttempts holds key `ip:6b78a0f4b73a97a8af62213c98bc7fbc` (= sha256("10.22.0.1")[0:32]) with count 2. Vercel behaviour not verified on prod (POST not allowed).
- Users hit: self-hosted deployments.
- Fix: use `x-real-ip`/`x-vercel-forwarded-for` only when `process.env.VERCEL`, else the last proxy hop or a configured trusted-proxy count.
- Last audit: new

### S4-04

**Placing a template twice labels both blocks "PUMP 1"**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/components/templates/TemplatesScreen.tsx:115-117
- Repro: Templates → Pump status block → Use template, twice.
- Expected: the second block reads PUMP 2.
- Actual: the count looks for names starting "PUMP"; the parts are named Panel_Pump1, Lbl_Pump1 and so on, so n is always 1.
- Proof: web/scripts/audit/s4-template-numbering.test.ts (7 failures, e.g. "pump-status: none of Panel_Pump1, Lbl_Pump1, Lamp_PUMP1_RUN, Lamp_PUMP1_FLT starts with "PUMP"")
- Users hit: template users.
- Fix: count by a pattern the template's own names use (e.g. a `prefix` field on Template).
- Last audit: new

### S4-10

**Server project card reads "Version 3 ? HMIST6500AWADI"**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/components/projects/ProjectsScreen.tsx:212
- Repro: sign in, upload a project, look at "Saved on the server".
- Expected: "Version 3 · HMIST6500AWADI".
- Actual: a literal "?" (a mangled middle dot).
- Proof: live: Projects page text "Version 3 ? HMIST6500AWADI".
- Users hit: all signed-in users.
- Fix: replace "?" with "·".
- Last audit: new

### S4-16

**Opening a just-uploaded server project from the Projects page shows no Share button and no live session**

- Status: open
- Severity: P3
- Where: web/src/components/shell/useProjectHydration.ts:116-117 (hydratedFor skips the cloud load for an id already hydrated in this page load)
- Repro: open a project, go to Projects, Upload to cloud, click its server card.
- Expected: Share appears and the session starts.
- Actual: neither, until a reload.
- Proof: live: flow 1 step 8 (header text had no "Share"; after reload it did).
- Users hit: uploaders, once.
- Fix: after uploadProject, call forgetHydration() or re-run loadCloudProject.
- Last audit: new

### S4-17

**Export claims too much: a "verified" badge on every export, and "Nothing in it was hand-drawn" in the README**

- Status: open
- Severity: P3
- Where: web/src/components/export/ExportScreen.tsx:286-295; web/src/components/export/useExport.ts:109-110
- Repro: export an opened .eote.
- Expected: claims that match the project.
- Actual: both always shown.
- Proof: live: flow 1 step 9 ("verified").
- Users hit: all exporters.
- Fix: drop the badge, and word the README from the project's origin (source, tagImport.pending).
- Last audit: new

### S4-26

**Landing says "699 tests"**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/app/page.tsx:204
- Repro: open /.
- Expected: a true figure, or none.
- Actual: 699 (the baseline is 1446).
- Proof: live: prod landing text.
- Users hit: all visitors.
- Fix: remove the number.
- Last audit: AUDIT_2026-10 §2 (stale count), still open

### S4-29

**The start pane shows a generic brief error instead of the server's**

- Status: open
- Severity: P3
- Where: web/src/components/shell/StartPane.tsx:151-153, 168-171 (reads `brief.error` from the render before the await)
- Repro: make /api/brief/draft fail (e.g. a quota error).
- Expected: the server's sentence.
- Actual: "the brief could not be drafted from that description".
- Proof: code: stale closure over `brief`.
- Users hit: screens-first users on a model failure.
- Fix: have draft() return the error, or render brief.error directly.
- Last audit: new

### S5-08

**Regenerate "Back" leaves the ghosts on the canvas**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/components/canvas/RegenerateDialog.tsx:86-93 (sets preview only in review, never clears it), :301 (Back)
- Repro: Regenerate, then Compare, then Back
- Expected: ghosts cleared on the recipe step
- Actual: the previous diff's ghosts stay until Close or Apply
- Proof: code path; no DOM test environment
- Users hit: users of regenerate
- Fix: clear the preview when stage leaves "review"
- Last audit: new

### S5-09

**Library drops ignore what is on the screen and the panel edge**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/components/library/LibraryPanel.tsx:167-186, web/src/components/library/LibraryScreen.tsx:77-99 (duplicated logic)
- Repro: on a 1024x600 screen holding 12 Path parts, place a symbol
- Expected: a free slot (lib/ote/regions.ts resolveSlot exists for this)
- Actual: top = 96 + 3x180 = 636, below the 600 panel; earlier drops land on content
- Proof: arithmetic from the code. Measured on the real files: 0 screens currently at 12 Path parts, so it is hit by building, not by opening
- Users hit: users of the library
- Fix: use resolveSlot({region:"body"}) for the drop box; share one place() function
- Last audit: new

### S2-09

**Signed-out callers can tell which project ids exist**

- Status: open
- Severity: P3 (information leak; ids are client-chosen strings)
- Where: web/src/lib/server/access.ts:68 (404 before the identity check in requireReader), used by GET /api/projects/[id], /stream, /changes, /realtime-token, /proposals
- Repro: no cookie: GET /api/projects/<real id> -> 401; GET /api/projects/<missing> -> 404.
- Expected: the same 401 for both when no identity or link is presented (requireAccess already does this).
- Actual: 404 vs 401.
- Proof: web/scripts/audit/s2-access-leaks.test.ts (fails with `the status tells a stranger which project ids exist: expected { real: 401, missing: 404 } to deeply equal { real: 401, missing: 401 }`); prod: GET /api/projects/abc -> 404 `Project not found` with no session.
- Users hit: rare.
- Fix: in requireReader, when there is no user and no share token, throw 401 before looking the project up.
- Last audit: new

### S2-11

**The Realtime INSERT policy lets any token holder broadcast forged notices**

- Status: open
- Severity: P3 (a viewer, or a member removed less than 15 minutes ago, can broadcast `revision` messages with any payload on the project topic; each listening browser then re-fetches /changes; no data is changed because clients never trust the payload)
- Where: supabase/migrations/20261030170741_realtime_policies.sql:46-51; token TTL web/src/lib/realtime/token.ts:49
- Repro: mint a token as a viewer, join `project:<id>` with supabase-js, `channel.send({type:"broadcast",event:"revision",payload:{rev:1e9}})` in a loop.
- Expected: browsers can only receive; only the server (secret key, not subject to RLS) publishes.
- Actual: INSERT allowed for any token naming the topic. No client code sends (grep `channel.send` in web/src: 0).
- Proof: code (policy lines above); not run (no Supabase credentials used by this stream; `npm run realtime:check` does not test it).
- Users hit: rare.
- Fix: drop the INSERT policy (needs Shaurya: run `drop policy "a token may only broadcast on the topic it names" on realtime.messages;` in the Supabase SQL editor, and delete it from the migration); add a realtime:check case that a minted token's send is refused.
- Last audit: new

### S2-16

**The live change path skips the checks a whole-snapshot save makes**

- Status: open
- Severity: P3 (an editor can set `name` to a megabyte string, `target` to a non-object, or `source`/`sourceId` to another account's file id through POST /changes; the source id cannot be read through it (readSource re-checks), but later whole saves by other members then fail with 403 "You do not have access to this source", and exports break on a malformed target)
- Where: web/src/lib/collab/changes.ts:948-949 (`setField` checks only the field name); compare web/src/lib/server/http.ts:40-55
- Repro: POST /api/projects/<id>/changes `{changes:[{id:"x",base:N,ops:[{kind:"setField",field:"target",value:"oops"}]}]}` as an editor -> accepted.
- Expected: the same shape rules as `snapshot()` (name 1..255, target {model,width,height}, source ids readable by the author).
- Actual: accepted.
- Proof: code (no test written: time).
- Users hit: rare (needs an editor).
- Fix: validate `setField` values per field in validStoreChange; check source ownership in the changes route.
- Last audit: new

---

### S4-11

**Top-bar Export link and chat "Import a tag export" link point at /project//… before the project loads**

- Status: open
- Severity: P3 cosmetic
- Where: web/src/components/shell/TopBar.tsx:137, 253; web/src/components/chat/ChatPanel.tsx:82, 258 (built from the store's `id`, "" until hydrate)
- Repro: open a project on prod and watch the network.
- Expected: /project/<id>/export.
- Actual: prefetch of `/project//export` → 308 → `/project/export`. A click in that moment opens a project with id "export".
- Proof: live prod network log: `GET /project//export?_rsc=… => 308`, `GET /project//tags?_rsc=… => 308`.
- Users hit: rare (first second after load).
- Fix: take projectId from the route (as NavRail does), not from the store.
- Last audit: new

### S4-27

**Ctrl+K opens the palette from inside a text field**

- Status: open
- Severity: P3
- Where: web/src/components/shell/CommandPalette.tsx:230-242
- Repro: type in the chat box, press Ctrl+K.
- Expected: per the comment, nothing.
- Actual: the palette opens.
- Proof: code: no target check in onKeyDown.
- Users hit: rare.
- Fix: return when the target is an input, textarea or contenteditable.
- Last audit: new

### S4-28

**On a network failure, the generation log says "replaying the bundled demo screen", then nothing is built, and a fresh run leaves zero screens**

- Status: open
- Severity: P3
- Where: web/src/components/generation/useGeneration.ts:227-236; useChat.ts:212-224 (stopped is undefined for the local path)
- Repro: /api/generate unreachable, non-demo tags, first build.
- Expected: one honest error, and the blank screen kept.
- Actual: a misleading log line, "Nothing was added", and screens = [] after resetRun.
- Proof: code path: mockGeneration's error event is applied but not returned as pipelineError.
- Users hit: rare (offline).
- Fix: return the mock's error message as pipelineError; drop the pre-log.
- Last audit: AUDIT_2026-10 fake-pipeline follow-up
