# Handoff: screens first, tags later

For: Pranav (picks this up with Claude). Written 2026-10-22 from the code on `main` at 91503bb plus the Fill fix in the working tree.

## Why this exists

Krishnadas (Schneider) reviewed the demo and said the workflow is tag-first. Engineers design screens first and import tags later, then bind. Today the app cannot do that. The full plan is `docs/PLAN_SCREENS_FIRST_AND_FILL.md` (Part B). This file is the self-contained brief for the workflow part.

## Where the code stops today (verified)

- `web/src/lib/ai/pipeline.ts:103`: with zero tags the pipeline fails with "no tags supplied" and stops at step 1.
- `web/src/app/api/regenerate/route.ts:29`: returns `code: "no-tags"`, "Import the tag export first".
- `web/src/lib/ote/bindings.ts`, `buildGraph`: throws `binding references "<tag>", which is not in the variable list` for any unknown tag. It has no way to say "this object is not bound yet".
- `web/src/lib/plant/model.ts`: the Plant Model is derived from the tag list. No tags, no equipment.
- Hand-drawn screens work (canvas Insert menu). The inspector binds one object to one tag through `setBinding`. Nothing matches many tags to many objects.
- `web/src/store/project.ts` `importScreens` and `ImportScreensDialog.tsx`: importing screens from another .eote works. Use it as a reference for how screens enter the store.

## What to build

1. **Unbound is a valid state (B1).** Validation in `web/src/lib/validation/semantic.ts` must treat "no binding yet" as a status, not an error, when there are no tags or the object has no intent. `buildGraph` must skip unbound objects. Keep the throw for a binding that names a tag that does not exist. Store an optional `bindIntent` on each object in the app store only (not written into the .eote).
   - Test: a screen with three unbound bars exports with zero Bindings rows and does not throw.

2. **Binder on tag import (B3).** When tags are imported into a project that has screens, match each unbound object to tags:
   - an explicit `bindIntent` that names a tag;
   - object name tokens against tag name tokens (`Ind_TNK_Bar` against `TNK_101_LEVEL`);
   - Plant Model role: the object's equipment class against the tag's class and role.
   Each match gets a confidence. High confidence is proposed, low stays unbound. Show proposals in a review panel modelled on `web/src/components/tags/useTagImport.ts` (corrections are reported, never applied silently). Accept calls `setBinding`; reject leaves the object unbound.
   - Test: a fixture of 12 tags and 6 unbound objects proposes the 4 clear matches and leaves 2 ambiguous ones unbound.

3. **Generate without tags (B2).** Recommended: pending tag names. The pipeline accepts an intent with no tags, creates screens whose objects carry `bindIntent` and a pending name (for example `TNK_1_LEVEL`), and keeps pending names out of Variables.db until they are bound. Change `pipeline.ts` and `/api/regenerate` from "fail" to "generate pending". Only a request to bind with nothing to bind to should still fail.

4. **Chat and inspector (B4).** Chat op "bind the tank bar to TNK_101_LEVEL" goes through the same applier path as other ops. The inspector shows bound or unbound per object.

5. **Export order (B5).** Variables.db rows must exist before the Bindings rows that name them. `packager.ts` already writes variables first. Add a test that exports a screens-first project and checks the order and the row count.

6. **Verify (B6).** Build a screens-first project in the app, import tags, accept the binder's proposals, export, and open it in licensed OTE. The bench (`web/scripts/ote-bench.ps1`) proves it opens and simulates. Check bound values by eye.

## Decisions to confirm with Shaurya before starting step 3

- Pending tag names, or require a tag list first? Recommendation: pending names.
- Binder auto-applies high-confidence matches, or always asks? Recommendation: always asks in this first version.
- Does `bindIntent` survive a round trip through the .eote? Recommendation: no. Keep it in the store.

If Shaurya has not answered, do steps 1, 2, 4 and 5 (they need no decision) and leave step 3 for after.

## Ground rules from the repo

- Schneider's files (`web/skeleton/`, `graphics-index.json`) are never committed.
- Run the full suite before you hand back: `cd web && npx vitest run` (currently 1158 passing) and `npx tsc --noEmit -p .`.
- Do not commit or push unless Shaurya asks. Commits carry Shaurya's name only, with no AI co-author line.

## Related

- `docs/PLAN_SCREENS_FIRST_AND_FILL.md`: full plan, both parts.
- `web/src/lib/ote/schema.ts` `Paint`: changed by the Fill fix. Re-run `web/tests/fill.test.ts` if you touch it.
- Memory: `hmi-copilot-v2-direction` and `ote-bench-licensed` describe the phase order and the OTE bench.
