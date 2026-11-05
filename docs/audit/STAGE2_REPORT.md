# Audit 2026-11, Stage 2: what was fixed

*Branch `fix/audit-2026-11`, on top of the audit report (`8293b7a`). One bug per
commit. Each fix has a regression test in `web/tests`. Each test fails on the
code before its fix and passes after it. The status of every bug is in
[BUGS.md](BUGS.md).*

## In one paragraph

All 3 P0 bugs are fixed. Of the 12 P1 bugs, 11 are fixed;
the last P1 (S2-07, storage quotas) waits for a product decision. 14 P2 bugs
are fixed and 1 is part fixed. No P3 bug was started. The full suite and
`tsc` passed after every commit.

## Fixed

| Bug | Sev | What was wrong | Commit |
|---|---|---|---|
| S1-03 | P0 | Editing one tag reset every other tag's InitialValue | d2864b5 |
| S3-01 | P0 | A read-only connector token could write | 79a2463 |
| S1-05 | P0 | A carried binding could move onto another part | 2b5b179 |
| S1-01 | P1 | Projects that hold Compound Objects could not be exported | 78fb189 |
| S1-06 | P1 | Accepting a proposal reverted every edit made after it appeared | 43f9794 |
| S2-01 | P1 | `/signin?next=` could send users off-site | 6c27db5 |
| S2-02 | P1 | The routes that call the model took anonymous callers and any body size | e7fa6aa, 4c41fea |
| S2-03 | P1 | The laptop store dropped MCP generate jobs | 345a564 |
| S2-04 | P1 | Four kinds of save sent no live-sync notice | 803c62f |
| S2-06 | P1 | The knowledge base had no sign-in or origin check | 0f4c173 |
| S3-10 | P1 | Rendering a short screen crashed the server process | 480e4c1 |
| S4-01 | P1 | Reopening a project showed the "New project" pane over it | c664057 |
| S4-22 | P1 | On Supabase Realtime, proposals and agent steps never reached the tab | 538ba50 |
| S1-09 | P2 | An op that named a screen edited a namesake on another screen | 35a1d13 |
| S2-05 | P2 | Anyone could lock any account out of sign-in | df983c6 |
| S2-08 | P2 | Pages could be framed by another site; X-Powered-By sent | 9c8f899 |
| S2-10 | P2 | Every member, viewers too, got every member's email address | 0ef6b25 |
| S3-02 | P2 | The agent could delete core files through a folder, the root or a script | 5d69132 |
| S3-03 | P2 | alignObjects dropped missing targets and reported a no-op spread as done | ed0bb1c |
| S3-06 | P2 | MCP generate took a brief with an unbounded unit count | bcdb85d |
| S3-07 | P2 | A model-written regex could block the event loop for seconds | 7b62ea8 |
| S4-02 | P2 | Restoring the oldest of 20 versions did nothing | 711f5b8 |
| S4-03 | P2 | A new project inherited the last project's standards | 758dc8a |
| S4-05 | P2 | Plant "Rebuild from tags" dropped the ranges the engineer typed | ee1d368 |
| S4-06 | P2 | Variables.csv listed placeholder tags the .eote leaves out | 2b7483a |
| S4-07 | P2 | Undo after deleting a composite brought back loose parts | 0a2d46e |
| S4-08 | P2 | Restoring a version dropped locks, groups, keys, composites and programs | 1b693cf |

## Part fixed

| Bug | Sev | Fixed | Left, and why |
|---|---|---|---|
| S3-05 | P2 | A refresh token presented with another client's id is refused (86a0aec) | Requiring `client_id` on the code exchange changes the OAuth wire contract for clients that leave it out: needs Shaurya. Claude sends it. |

## Needs Shaurya

- **S2-07, storage quotas (P1).** The limits are a product decision.
- **S3-01, the 403 shape.** Scopes are enforced. Whether a refusal should also
  carry a `WWW-Authenticate` challenge is a connector-contract choice.
- **Writer output.** S1-03, S1-05, S1-01 and S1-02 change what the .eote writer
  writes. Benched afterwards in licensed OTE 4.4.20.31 (branch
  fix/audit-2026-11-review): on auto&manua.eote, the only project whose original
  simulates, the original and 15 edited exports all simulate (comment, tag add,
  STRING tag, rebind, new wires, bound-part and Compound Object delete, alarm
  add, data type change). The other three originals carry OTE errors of their
  own, so for them OTE can show only that an export opens: 24 of 24 exports for
  Panel1 and Drive_4.1, 2 of its 10 for Motor_Drive_Control_4.1, the rest not benched. What causes
  those errors is not known.
- **S2-08, CSP.** Only `frame-ancestors` is set. A full `script-src` policy
  needs nonces for Next's inline scripts and a check of every page.

## Not fixed in this pass

- **UI-only bugs** (S4-12, S4-13, S4-14, S4-15, S4-19, S4-21, S4-23): the fix
  lives in a React component, and the repo has no component test harness
  (no testing-library, no jsdom), so none of them could get a regression test.
  Adding that harness is the first step for these.
- **Concurrent edits** (S1-07 shared handles, S1-08 per-field merge): the change
  log needs a design change, not a patch.
- **Layout** (S5-01, S5-02, S5-04, S5-06, S6-01, S6-04, S3-09): S5-02 needs the
  nested-canvas solver in [DESIGN_NESTED_CANVAS.md](DESIGN_NESTED_CANVAS.md); the
  rest were not reached.
- **Not reached:** S1-04, S1-10, S1-11, S1-12, S2-12, S2-13, S2-15, S4-25, and
  all 28 P3 bugs.

The proof tests for open bugs stay in `web/scripts/audit/` and still fail.

## Tests and types

| | Test files | Passed | Skipped | `tsc --noEmit` |
|---|---|---|---|---|
| Before (`5fd701d`, no local server) | 110 | 1446 | 24 | 0 errors |
| After (this branch, same command) | 137 | 1521 | 9 | 0 errors |

Command: `cd web && MONGODB_URI= npx vitest run`.

## Import fidelity

| | Before (`5fd701d`) | After (`ed0bb1c`) |
|---|---|---|
| Weighted: read / drew / took the edit | 98.4 / 99.3 / 98.9 % | 98.4 / 99.3 / 98.9 % |
| Weighted: survived the writer | 95.8 % | 96.3 % |
| Weighted: survived, and the export route lets it out | 66.1 % | **96.3 %** |
| The 4 distinct engineer files: ops that survive and export | 41/207 = 19.8 % | **189/207 = 91.3 %** |
| Files the export route refuses | 4 | 0 |

Measured by `web/scripts/audit/fidelity.mts`, same corpus; details in
[IMPORT_FIDELITY.md](IMPORT_FIDELITY.md#before-and-after). OTE Expert opening
the output is **not verified**.

## Notes for review

- **Commit `538ba50` (S4-22)** adds a `userId` field to the realtime-token
  response, so a tab shows only its own agent steps. Any project member's token
  may broadcast on the project topic (the policy checks the topic only), so a
  member could post a fake agent line to another member's tab. That was
  already true of revision hints, which are only hints.
- **Commit `43f9794` (S1-06)** re-runs a proposal's ops when the project moved
  since the proposal was drawn. An op that no longer applies is now rejected
  and listed, rather than landing stale.
- **Commit `df983c6` (S2-05)** keys the 10-try window on email and IP, with a
  100-try ceiling per email across all IPs.
- **Commit `bcdb85d` (S3-06)** sets the ceiling at 100 units per brief row.
- No test account was made on production. Every production check was read-only.
