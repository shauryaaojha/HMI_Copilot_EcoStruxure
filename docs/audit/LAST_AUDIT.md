# The last audit (AUDIT_2026-10): what is fixed and what is still open

*Audit 2026-11, branch `audit/2026-11`. Each stream checked the AUDIT_2026-10 findings in its own area against the code at `5fd701d`. The tables are as each stream wrote them.*

## Stream S1

| id | Finding | Status | Evidence |
|---|---|---|---|
| §3.1 | Second alarm group moved and reset on any alarm edit | fixed | reader.ts:657-672 models only the first group and keeps rows; syncAlarms reuses them (Preserved.alarms.rows) |
| §3.2a | Damaged Bindings.dat exported with every binding dropped | fixed | reader.ts:574 `json("Bindings.dat", true)` throws IngestError "damaged" |
| §3.2b | Damaged Screen.dat failed the whole open | fixed | reader.ts:335-352 warns and carries it |
| §3 ZIP guard | Inflate unchecked | fixed | ingest/zip.ts guardZip, called at reader.ts:319 |
| §8 | Preflight refused array/member variable rows (43 templates) | fixed | preflight.ts:31, 58-63 |
| §2 / §7.1 | "Two .eote open in OTE 4.4" and open one export after alarm sync | still open (not verifiable here) | No OTE on this machine; no bench run on these outputs |
| §7.3 | One real .vdz to confirm the container layout | still open | No .vdz on this machine |
| §3.3, §3.4, §3.5, §3.6 | XLSX Summary sheet, Vijeo CSV, x-file-name %E0, LT_101 wording | not S1's files (lib/tags, the import route, the generator) | none |

## Stream S2

| id | finding | status | evidence |
|---|---|---|---|
| §3.5 | `x-file-name: %E0` threw outside the try: 500 on every import route | fixed | lib/ingest/errors.ts:105-116 decodes inside try/catch; tests/ingest.test.ts has the %E0 case |
| §3 "ZIP guard that checks declared sizes before inflating" / body cap | fixed and still in place | lib/ingest/body.ts:13-47 (streamed cap), used by import, import/screens, knowledge, upload parts |
| §3 "safe client-side JSON handling for HTML error pages" | in place | lib/ingest/client.ts `expectJson` used by lib/client/upload.ts:250-257 and snapshot.ts:227-235 |
| §6 knowledge store "off by default with a shared DB, since tag names are customer data" | still true on prod (GET /api/knowledge -> store "off"), but the route has no identity check if anyone turns it on | S2-06 |

No other AUDIT_2026-10 finding touches auth, sessions, live sync or route limits (that audit predates accounts
and Realtime).

---

## Stream S3

| Id | Finding | Now | Evidence |
|---|---|---|---|
| §3.3 | OTE XLSX export read the Summary sheet | fixed | web/src/lib/tags/table.ts:52-56 picks `Variables`; tests/ingest.test.ts:246 |
| §3.4 | Vijeo CSV skipped every row | fixed | web/src/lib/tags/parse.ts:91-92, 246 (most-specific alias, row-kind column) |
| §3.6 | Level alarm worded "Pump 101 level high" | fixed | web/src/lib/library/machines.ts:157 `{label} level high`, on the level role |
| §2 | Equipment inference was a prefix table | fixed | web/src/lib/ai/infer.ts uses the library and DDT structure; tests/infer-library.test.ts |
| §2 | ISA-18.2 rationalisation | built | web/src/lib/alarms/rationalise.ts; tests/rationalise.test.ts |
| §2 | `claude-opus-5` default | fixed | web/src/lib/ai/provider.ts:33 `claude-opus-5-5` |
| §5 | Regenerate as a diff, not delete-and-recreate | built | web/src/lib/program/regenerate.ts, recompile.ts; tests/regenerate.test.ts |
| §6 | Knowledge store off by default with a shared DB | still true | web/src/lib/knowledge/store.ts:27-32. But the route has no auth (S3-08). |
| §6 | Seven-tool registry and deterministic router | still there, now 9 tools | web/src/lib/ai/tools.ts |
| §4 | "Review every AI edit" setting | still there | web/src/lib/ai/review.ts:37-40 |

## Stream S4

| id | finding | status | evidence |
|---|---|---|---|
| §2 / §3 "Fake local pipeline" | The client fallback replayed the demo pump station over any tag list | **fixed** | mockPipeline.ts:103-115 refuses unless every fixture tag is present; tests/generation.test.ts "refuses to replay the demo screen over somebody else's tags". Residual: useGeneration.ts:230 logs "replaying the bundled demo screen" before the refusal (S4-28) |
| §2 README "337 tests" stale | | **still open** (now "869" in README, "699" on the landing) | README.md Status; src/app/page.tsx:204 |
| §4 "Review every AI edit" setting | built | **present**: SettingsScreen.tsx:85-89; but it leaks into the next new project (S4-03) |
| §4 per-op ticks, "Apply n of m" | built | **present**: ChatPanel.tsx:396-446 |
| §5 regenerate as a reviewed diff | built | store present (slices/alarms.ts:271-316); UI is S5's canvas |
| §7 items 1-5 (need a person or a file) | | not in my area |

## Stream S5

| Id | Finding | Status | Evidence |
|---|---|---|---|
| §2 "Regeneration never silently discards hand work" | not implemented then | fixed | RegenerateDialog.tsx:1-21, 121-133 (protected units unticked by default), /api/regenerate, tests/regenerate.test.ts |
| §4 Risky edit as proposal with ghosts | built | still true | ScreenRenderer.tsx:556-595 draws added/removed/moved ghosts |
| §6 lib/knowledge (scan, store local by default, conventions) | built | still true, but the route has no auth (S5-05) and the store is empty | api/knowledge/route.ts:26-70; 0 records local; prod store "off" |
| §7.4 feed the template corpus through POST /api/knowledge so conventions are not circular | open | still open | 0 records locally and on prod |
| §6 lib/ai/tools.ts "seven read-only tools" | | now 9 tools | TOOLS.length = 9 (run time) |
