# FEATURE_STATUS: what is really done

*Audit 2026-11, branch `audit/2026-11` off `main` at `5fd701d`. Each answer is **yes**, **partly** or **no**, with the evidence: code (file:line), a test, or a live check. Live checks ran against a local production build (`next start`, file store, no production database) on 2026-11-04. Production was read only over HTTP GET: no test account could be made there (the session's permission system refused the sign-up POST), so every check that needs a signed-in production session says "not verified on prod".*

## Verdicts

| Area | Verdict | One line |
|---|---|---|
| Accounts | **partly** | Sign up, sign in and a session that survives a reload work. Sign-out leaves the session cookie valid for 30 days ([S2-15](BUGS.md#s2-15)). No password change, reset, email verification or account deletion. The sign-in rate limit lets a stranger lock any account ([S2-05](BUGS.md#s2-05)). `next=` can redirect off-site ([S2-01](BUGS.md#s2-01)). |
| claude.ai MCP connector | **31 of 35 applicable server MUSTs met (89%)** | Metadata, DCR, PKCE S256, consent, token, refresh rotation and revoke work, and all 10 tools answered through the MCP Inspector. Not met: scopes are never enforced ([S3-01](BUGS.md#s3-01), P0); codes and refresh tokens are not bound to their client ([S3-05](BUGS.md#s3-05)); RFC 7591 error codes. **Not yet tried from a real claude.ai account.** |
| Agent and chat alignment | **chat: partly; agent: no** | Chat `alignObjects` and `tidyLayout` gave measurably right geometry for "align" and "fix this overlap". "Make it tidy" left 3 overlaps inside a card and reported done ([S3-09](BUGS.md#s3-09)). There is no op for match size, snap to grid or an already out-of-bounds part. The agent has no geometry tool at all, and all 3 agent runs were stopped by Gemini 503s. |
| Live sync | **partly** | Two tabs sync edits, and the SSE fallback works for a signed-out viewer. Four of the five server write paths send no Realtime notice ([S2-04](BUGS.md#s2-04)), proposals and agent steps never reach a Realtime tab ([S4-22](BUGS.md#s4-22)), and viewers can broadcast ([S2-11](BUGS.md#s2-11)). |
| Comments | **yes** | Pins, replies and resolve work; they refresh by a 10 s poll, not push. |
| Share links | **yes** | Viewer, commenter and editor links work and can be revoked. Export is on by default for commenter and editor links ([S4-18](BUGS.md#s4-18)). |
| History and undo | **partly** | Undo and redo work, and a chat turn is one undo step. Restoring the oldest version does nothing ([S4-02](BUGS.md#s4-02)), a restore drops object metadata ([S4-08](BUGS.md#s4-08)), and undo of a deleted composite brings back loose parts ([S4-07](BUGS.md#s4-07)). |
| Export | **yes for the files, partly for the claims** | The zip holds the .eote, Variables.csv, the report and a README. Any project holding a Compound Object is refused with a 409 ([S1-01](BUGS.md#s1-01)). The "verified" badge and the README overclaim ([S4-17](BUGS.md#s4-17)). Whether OTE opens the output: **not verified** (no OTE here). |

## Accounts

Sign-up is open to anyone with an email address; there is no email vendor (decision 1), so nothing is ever
verified. Prod has no test account (creation was denied by the permission system); every signed-in check below
was done locally or in-process and is marked "not verified on prod".

| Capability | Status | Evidence |
|---|---|---|
| Sign up | **yes** | POST /api/signup -> credentials.ts:86-101. Local 2026-11-04: `s2-a@hmicopilot.test` -> 201, profile without hash. tests/credentials.test.ts. Not verified on prod (no prod account). |
| Sign in | **yes** | Auth.js Credentials -> verifyPassword (auth.ts:19-24, credentials.ts:109-128); tests/credentials.test.ts. Local: csrf + POST /api/auth/callback/credentials -> 302 with `authjs.session-token` (HttpOnly, SameSite=Lax, 30-day Expires; no Secure on http). Not verified on prod (no prod account). |
| Sign out | **partly** | Local: POST /api/auth/signout clears the cookie (Max-Age=0), but replaying the pre-sign-out cookie still returns the user from /api/me ([S2-15](BUGS.md#s2-15)). |
| Session survives a reload | **yes** | Local: after sign-in, a fresh GET /api/me with only the cookie returns the user; JWT decoded per request (session.ts:31-32). Not verified on prod. |
| Change password | **no** | No route or UI: no `password` handler under web/src/app/api; only signUp and verifyPassword exist (credentials.ts:7-9 "Two functions are the whole surface"). |
| Reset a forgotten password | **no** | No route, no mail vendor (credentials.ts:2-5). An engineer who forgets the password has no way back; an admin must edit Mongo. |
| Verify an email | **no** | No verification; any address can be registered by anyone (credentials.ts:16-20 says so). |
| Delete an account | **no** | No route; `Repo.users` has upsert/get/create/credential only (repo.ts:100-105). Projects can be deleted by their owner (projects/[id] DELETE). |
| Rate limit on sign-in | **yes**, with a flaw | 10 per email and 50 per IP per 15 min, stored in the repository (rate-limit.ts:57-59, credentials.ts:119-120). Flaw: a stranger can lock any account ([S2-05](BUGS.md#s2-05), test fails). Per-IP bucket trusts X-Forwarded-For off Vercel ([S2-14](BUGS.md#s2-14), local measurement). |
| Rate limit on sign-up | **yes** | Same buckets (credentials.ts:96-97). |
| Lockout | **partly** | A 15-minute window, not a lockout with notice; it locks the owner out too ([S2-05](BUGS.md#s2-05); local: owner refused after a stranger's 10 wrong tries, Auth.js shows `error=Configuration`). |
| /signin next= cannot redirect off-site | **no** | `https://evil.example` and `//evil.example` are refused, but `/\evil.example` and `/\t/evil.example` go off-site ([S2-01](BUGS.md#s2-01); test fails; local signed-in 307 `location: /\evil.example`; prod GET shows the value reaching the form). |
| Sign-up enumeration | sign-in: no oracle; sign-up: oracle | Sign-in refusals are uniform and equal-time (credentials.ts:121-123); sign-up answers 409 `unavailable` for a taken address (local: second sign-up of `S2-A@...` -> 409). |

**What open sign-ups expose today.** Anyone can create unlimited accounts (50 per IP per 15 minutes, more with
more IPs), with any email address, unverified, so an account name proves nothing. Each account can: create
projects (up to 64 MB snapshots each) and permanent source files (100 MB each) with no quota ([S2-07](BUGS.md#s2-07)); mint
personal access tokens and connect claude.ai; receive and join any share link it is sent. It cannot read anyone
else's project without a membership or a link (authorisation matrix F1: every project route checked, no hole
found). Separately from sign-up, the model routes need no account at all ([S2-02](BUGS.md#s2-02)), so the paid model is
already open to anonymous callers, and anonymous uploads (24 h) are open too.

Verdict: **partly**. Sign up, sign in and sessions work; password change, reset, email verification and account
deletion do not exist; rate limiting exists but can be turned against the user; the next= guard has a bypass.

## The claude.ai MCP connector

**Verdict: 31 of the 35 server-side MUSTs that apply are met (89%).** Every check on the local server was a live, hand-driven flow (SCRATCH\s3\oauth-flow.sh). Production got read-only metadata GETs only. **This connector has not yet been tried from a real claude.ai account.** Nobody has added it as a custom connector in claude.ai, so Claude's own client has never run this flow.

Sources read 2026-11-04:
- MCP versioning: https://modelcontextprotocol.io/specification/versioning (current revision `2026-07-28`)
- MCP authorization 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization, plus its sub-pages `/authorization-server-discovery`, `/client-registration` and `/security-considerations`
- OAuth 2.1: https://www.ietf.org/archive/id/draft-ietf-oauth-v2-1-13.html (the draft that MCP cites)
- Claude, connector authentication: https://claude.com/docs/connectors/building/authentication
- RFC 9728, 8414, 7591, 7636, 7009 and 8707, through the MCP pages' normative references

Two notes on the sources:
- Claude's authentication page now links only the 2025-11-25 authorization spec. It no longer carries the line docs/CONNECTOR_SPEC_NOTES.md:27-28 quotes ("Claude follows the 2025-03-26, 2025-06-18, and 2025-11-25 authorization specifications"). See section C.
- 2026-07-28 marks Dynamic Client Registration as **deprecated** and makes CIMD a SHOULD. Claude still uses DCR when `client_id_metadata_document_supported` is absent, so DCR still works today.

#### What was run, and what it returned

Local runs used the shared test account. Production rows are read-only GETs at 01:39Z.

| Check | Local | Production |
|---|---|---|
| `GET /.well-known/oauth-protected-resource` (root and `/api/mcp` suffix) | 200. `resource` is `http://localhost:3000/api/mcp`. `authorization_servers` has one entry. Scopes are `mcp:read mcp:write offline_access`. | 200, same shape, `resource` is `https://hmibuildtimecopilot.vercel.app/api/mcp`, CORS `*`, no-store |
| `GET /.well-known/oauth-authorization-server` | 200. Has issuer, authorize, token, register and revoke endpoints. `S256` only. Auth method `none`. | 200, issuer `https://hmibuildtimecopilot.vercel.app` |
| `GET /.well-known/openid-configuration` | 404, which is allowed: RFC 8414 alone is enough | not checked |
| `POST /api/mcp` with no token | 401, `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`. No `scope=` (a SHOULD) | not verified on prod (POST not allowed) |
| DCR `POST /api/oauth/register` (JSON) | 201 in 0.02 s. Public client. Redirect URIs checked. | not verified on prod (no prod account, POST) |
| `/oauth/authorize` with no session | 307 to `/signin?next=...`, with the request kept | not verified on prod |
| Consent page | 200. Shows client name, the signed-in account, one line per scope, and the redirect **host** in bold (`127.0.0.1:33418`). Allow and Deny. | not verified on prod |
| Consent POST with no `Origin` | 403 | not verified on prod |
| Consent POST Allow | 303 to the redirect URI with `code` and the same `state`. No `iss` parameter (a SHOULD) | not verified on prod |
| Token, form-encoded `authorization_code` + PKCE + `resource` | 200 in 0.03 s. Bearer, `expires_in` 3600, refresh token issued because `offline_access` was asked for | not verified on prod |
| Same code again | 400 `invalid_grant` | - |
| `initialize` with the bearer token | 200, `protocolVersion 2025-11-25`, server `hmi-copilot` | - |
| Refresh | 200. The refresh token rotated. Using the old one again gives 400 `invalid_grant` | - |
| Refresh with **another client's** `client_id` | **200, new tokens issued** ([S3-05](BUGS.md#s3-05)) | - |
| Code exchange with **no** `client_id` | **200, tokens issued** ([S3-05](BUGS.md#s3-05)) | - |
| Token only in the query string | 401 | - |
| Garbage bearer token | 401, with the `resource_metadata` pointer | - |
| Token with scope `mcp:read` only, calling `propose` | **200, proposal queued** ([S3-01](BUGS.md#s3-01); audit test) | - |

#### Every server-side MUST, met or not

| # | MUST (source) | Met? | Evidence |
|---|---|---|---|
| 1 | MCP servers MUST implement RFC 9728 protected resource metadata (authz, Overview 4) | met | web/src/app/api/oauth/protected-resource/route.ts:18, web/src/lib/server/oauth.ts:195-204; live 200 local and prod |
| 2 | That metadata MUST include `authorization_servers` with at least one entry (discovery) | met | oauth.ts:199 |
| 3 | MUST implement the `WWW-Authenticate resource_metadata` header on 401 or the well-known URI (discovery) | met, both | web/src/lib/mcp/http.ts:52-63; live |
| 4 | Authorization servers MUST provide RFC 8414 or OIDC discovery (Overview 5) | met | web/src/app/api/oauth/authorization-server/route.ts:15 |
| 5 | `issuer`, `authorization_endpoint`, `token_endpoint`, `response_types_supported` are REQUIRED (RFC 8414 §2) | met | oauth.ts:215-230 |
| 6 | The metadata `issuer` MUST equal the issuer the well-known URL was built from (RFC 8414 §3.3) | met | oauth.ts:216-218 uses the request origin; prod issuer equals the host |
| 7 | All authorization server endpoints MUST be served over HTTPS (security, Communication 1) | met on prod | prod metadata: every endpoint is `https://` |
| 8 | All redirect URIs MUST be localhost or HTTPS (Communication 2) | met | oauth.ts:263-265 |
| 9 | AS MUST validate exact redirect URIs against registered values, with only the port relaxed for loopback (security, Open Redirection; OAuth 2.1 §2.3.1) | met | oauth.ts:301-312; live |
| 10 | MUST NOT redirect to an invalid redirect URI or unknown client (OAuth 2.1 §4.1.2.1) | met | oauth.ts:369-381 throws AuthorizeRefusal, which web/src/app/oauth/authorize/page.tsx:53 renders in the page |
| 11 | AS MUST support PKCE and reject a public client's request without `code_challenge` (OAuth 2.1 §4.1.1, §4.1.2.1) | met | oauth.ts:390-394 |
| 12 | Verify `code_verifier` against the challenge (OAuth 2.1 §4.1.3) | met | oauth.ts:474-478, 546 |
| 13 | A code MUST expire shortly after it is issued (§4.1.2) | met | 2 minutes, oauth.ts:110 |
| 14 | MUST return an access token only once for a code (§4.1.3) | met | repo-connector.ts:210-219 claims and removes; live replay gave `invalid_grant` |
| 15 | For a public client, ensure the code was issued to the `client_id` in the request (§4.1.3) | **not met** | oauth.ts:543 checks only when `client_id` is sent; live step 15 |
| 16 | MUST keep the binding between a refresh token and its client (§4.3) | **not met** | oauth.ts:558-576 never reads `client_id`; live step 12 |
| 17 | Public clients' refresh tokens MUST be rotated or sender-constrained (security, Token Theft; §4.3.1) | met | oauth.ts:584-588; live |
| 18 | Refresh MUST NOT add scopes not originally granted (§4.3.1) | met | oauth.ts:575-577 |
| 19 | Refresh tokens MUST be bound to their scope and resource server (§3.2.3) | met | the audience and scopes are stored, oauth.ts:585-586 |
| 20 | MCP servers MUST validate access tokens, expiry included (authz, Token Handling; OAuth 2.1 §5.2) | met | oauth.ts:672-688 |
| 21 | MUST validate that the token was issued for this server as its audience (RFC 8707) | met | oauth.ts:681 |
| 22 | Invalid or expired tokens MUST get HTTP 401 | met | live step 14 |
| 23 | MUST send `WWW-Authenticate` when the credential is missing or invalid (OAuth 2.1 §5.3) | met | http.ts:59 |
| 24 | MUST accept only tokens valid for its own resources; MUST NOT pass through or accept other tokens | met | oauth.ts:677-681; no upstream call exists |
| 25 | Tokens MUST NOT be accepted from the query string (authz, Token Requirements) | met | oauth.ts:643-649; live step 13 |
| 26 | Servers MUST return appropriate status codes: 403 for invalid scopes or insufficient permissions (authz, Error Handling), and MUST account for scope hierarchies | **not met** | scopes are never checked ([S3-01](BUGS.md#s3-01)). A role refusal comes back as HTTP 200 with `isError` (web/src/lib/mcp/tools.ts:30) |
| 27 | The AS MUST clearly display the redirect URI hostname (security, Localhost Redirect URI Risks; Claude's docs require it too) | met | page.tsx:80-84; live |
| 28 | The AS MUST authenticate the user first (OAuth 2.1 §7.12.2) | met | page.tsx:46-47 |
| 29 | Secure token storage (security, Token Theft) | met | only SHA-256 hashes are stored, repo-connector.ts:9-15; tokens get a random public `_id` |
| 30 | DCR response MUST contain `client_id` and the registered metadata (RFC 7591 §3.2.1) | met | oauth.ts:270-282 |
| 31 | A DCR error MUST use a registered error code, such as `invalid_redirect_uri` or `invalid_client_metadata` (RFC 7591 §3.2.2) | **not met** | oauth.ts:254-265 answers `invalid_request`, which is not a RFC 7591 code |
| 32 | The AS MUST require registration of the complete redirect URI (OAuth 2.1 §2.3.1) | met | oauth.ts:256-267 |
| 33 | MUST support revocation of refresh tokens (RFC 7009 §2) | met | web/src/app/api/oauth/revoke/route.ts:15-21; a refresh token revokes its whole grant, oauth.ts:763 |
| 34 | An invalid token at the revocation endpoint answers 200 (RFC 7009 §2.2) | met | revoke/route.ts:19-20 |
| 35 | Authorization servers MUST implement OAuth 2.1 for public clients (Overview 1). This is the sum of rows 9-19. | met except rows 15 and 16 | - |

Not counted, because they do not apply: CIMD MUSTs (CIMD is not implemented and is only a SHOULD); `authorization_response_iss_parameter_supported` (it applies only if `iss` is sent, and it is not); client-side MUSTs.

**SHOULD gaps** (not in the %):
- no `scope` in the 401 challenge;
- `offline_access` is in the protected-resource `scopes_supported`, which the spec says SHOULD NOT be there (oauth.ts:200);
- no `iss` in the authorization response (RFC 9207);
- no CIMD;
- no extra warning when the only redirect URIs are loopback;
- the revocation endpoint does not check that the token belongs to the presenting client, and it has no rate limit (revoke/route.ts:15-21);
- a reused code does not revoke the tokens already issued from it (OAuth 2.1 §4.1.3 SHOULD).

#### The personal access token fallback
`createPersonalToken` (oauth.ts:616-629): prefix `hmi_pat_`, 90 days, all scopes, only the hash stored. It is read from `authorization: Bearer` or `x-api-key` (oauth.ts:643-649), never from the query string. A personal token has no audience (oauth.ts:624-626), so it works on every hostname of the deployment. Revocation is per token (repo-connector.ts:256-263).

#### Every tool in web/src/lib/mcp/tools.ts, called through the MCP Inspector

These were called with MCP Inspector CLI 2.13.0 (`npx @modelcontextprotocol/inspector --cli http://localhost:3000/api/mcp --transport http --header "Authorization: Bearer <PAT>"`), using a personal access token made through POST /api/account/tokens (201, scopes `mcp:read mcp:write offline_access`).

The project was "S3 Align (audit)", POSTed to /api/projects (201) from the tracked-sample scenario. The script is SCRATCH\s3\inspector-tools.sh and the outputs are in SCRATCH\s3\insp\.

`tools/list` returned 10 tools: list_projects, get_screens, find_tags, validate, render_screen, generation_status (read-only hint), and apply_ops, propose, generate, generation_cancel.

| Tool | Result | Notes |
|---|---|---|
| list_projects | ok, 2 projects, fenced in `<project-data>` | the first call took 12 s, mostly the npx start-up |
| get_screens | ok, 4 screens, 171 objects, 8181 chars | |
| find_tags `level` | ok, 4 of 20 tags | |
| validate | ok: 69 findings (0 errors, 9 warnings, 60 info), with the `_meta.ui` validation card | |
| render_screen PumpStation1 | ok: PNG 1024x600 at 100% (55 kB base64), plus the screen card | crashes the process on a screen of height 50 or less ([S3-10](BUGS.md#s3-10)) |
| apply_ops (alignObjects START/STOP) | ok: **proposal** queued, 1 waiting, 0 rejected | project not opted in to direct writes. A direct write was not tried live; tests/mcp.test.ts covers it. |
| propose (tidyLayout) | ok: proposal queued | |
| generate | refused `already-built` (isError) | correct: the project has objects. A build on an empty project was not run, to spare the shared Gemini quota. Locally its job would not be found anyway ([S2-03](BUGS.md#s2-03), FileStorage allow-list; not filed again here). |
| generation_status (unknown id) | refused `not-found` | |
| generation_cancel (unknown id) | refused `not-found` | |
| find_tags on an unknown project | refused `not-found` | |

**Verdict on the tools: 10 of 10 answer correctly for the paths tried.** Write and generate are refusals or proposals as designed. Scope enforcement is missing ([S3-01](BUGS.md#s3-01)).

## Alignment and bug fixes from the agent chat

#### (a) Which tools can do which geometry fix

| Fix | Chat (core/ops, sent by /api/chat) | Agent (web/src/lib/agent, /api/agent) | MCP (apply_ops) |
|---|---|---|---|
| Align left/centre/right/top/middle/bottom | yes: `alignObjects` + `mode` (web/src/core/ops/ops.ts:71-80; apply.ts:878-913, which calls store/edits.ts:53 `alignTo`) | **no tool**. It can only hand-edit `Location` with `json_set` (tools.ts:237-254), or use run_script or shell. The agent never sees the editor's align. | yes, the same `alignObjects` (web/src/lib/mcp/write.ts:257) |
| Distribute (spread) | yes: `alignObjects` with `spreadHorizontal`/`spreadVertical` (store/edits.ts:105). Needs 3 or more objects, else nothing moves (store/slices/objects.ts:208) | no tool | yes, the same op |
| Match size | **no op.** `resizeObject` takes one target and explicit numbers (apply.ts:669-693). The model must copy numbers it never sees, because the digest carries no sizes (converse.ts digest: positions are never in the context, docs/LLD.md §3.2). | json_set only | the same as chat |
| Snap to grid | **no op anywhere.** `clampToPanel` only rounds to whole pixels (lib/ote/place.ts) | no | no |
| Remove overlaps | yes: `tidyLayout` (apply.ts:852-876, which calls lib/ote/tidy.ts `planTidy`). It moves the smaller of each overlapping top-level unit to a clear side or region slot. It does **not** see overlaps between parts inside one card or faceplate ([S3-09](BUGS.md#s3-09)). | no tool. `clone_object` only *warns* that it overlaps something (agent/project.ts:330-335) | yes, `tidyLayout` |
| Fix out-of-bounds | **no op for parts already outside.** `clampToPanel` runs only on a move or resize the op itself makes (apply.ts:562, 630, 635, 683). tidy refuses targets outside the panel but never moves a part that is already outside (tidy.ts `clearAt`). | no | no |
| Report overlaps to the model | the digest's `Overlaps on it:` line uses the same `overlapsOn` (converse.ts digestOf), so it is blind in the same way as tidy ([S3-09](BUGS.md#s3-09)) | `check` does not report geometry (tools.ts:545-605); only `view_screen` gives a PNG | `validate` reports the rule-pack findings |

#### (b) The three prompts, run for real

**The screen.** web/scripts/audit/s3-scenario.mts takes the tracked sample `demo_project/HMICopilot_Bars.eote`, screen PumpStation1 (the app's own generated screen, 55 parts). Using the app's own ops, it adds:
- START (`Btn_Start`, Switch, 24,262, 120x44) and STOP (`Btn_Stop`, 104x36), placed 14 px lower and 24 px to the right of START;
- two overlapping labels, `Lbl_Mode` at 360,270 and `Lbl_Duty` at 420,278, each 200x20.

It packages the result into the opened file and reads it back: SCRATCH\s3\S3_Align.eote. That file was imported into the local server as the test account (POST /api/import, 200).

**How it was measured.** web/scripts/audit/s3-geometry.mts works on the reader's top-level parts. It leaves out parts covering at least half the panel, and pairs where one part holds the other. The baseline already has 3 overlaps (1240 px²) inside the sample's own Tank 101 card: the tank symbol over its level reading.

**Agent path (/api/agent, the Agent tab).** The model is `gemini-flash-latest`, the agent's default (lib/agent/run.ts:92); AGENT_MODEL is not set locally.

| Run | Started (UTC) | What happened |
|---|---|---|
| 1 | 01:45:05Z | 3 Gemini **503 UNAVAILABLE** ("high demand") retries at 3, 6 and 12 s. The 4th failed. 0 tool calls. |
| 2 | 07:22:25Z | 3 more 503s, then one model call (`project_summary`, 3833 input tokens). Cut at 320 s, which is past Vercel's 300 s `maxDuration` (agent/route.ts:28). |
| 3 | 12:15:38Z | 3 retries, then **503 UNAVAILABLE** again. 0 tool calls. No more retries, to spare the shared quota. |

Prompts 2 and 3 were not sent to the agent, because the model was unavailable on all 3 attempts at prompt 1. So no agent run produced a single geometry tool call. That is caused by **Gemini quota/load (503)**, not by the code. Structurally, though, the agent has no align, distribute, match-size, snap or tidy tool at all (a). Its best case is hand-written `json_set` arithmetic, which docs/LLD.md §1.2 explains is exactly what goes wrong.

**Chat path (/api/chat).** The same request the Chat tab sends, through web/scripts/audit/s3-chat-run.mts, on the server's model `gemini-flash-lite-latest`. The ops were dry-run and applied with core/ops, as useChat does.

| Prompt | Model call | Ops it chose | Measured before -> after |
|---|---|---|---|
| "align the start and stop buttons" | 07:29:14Z, 200, 1.6 s, 3671 in / 140 out tokens | `alignObjects targets [o57,o58] mode middle` | START/STOP vertical centre delta (dMiddleY) **10 -> 0 px**. Top-edge delta 14 -> 4 (the heights differ). Left delta 144 (side by side, as before). Overlap between them 0 -> 0. The rest of the screen is unchanged. **Correct.** |
| "these labels overlap, fix it" (both labels selected) | 12:15:05Z, 200, 7.5 s | `tidyLayout screens [s1]` | Lbl_Mode/Lbl_Duty overlap **1680 -> 0 px²**: Lbl_Mode moved from 360,270 to 420,312, under Lbl_Duty. Screen overlaps 4 -> 3. Label overlap area 2040 -> 360 px². **The asked-for pair is fixed.** The remaining 360 px² is the card-internal overlap tidy cannot see ([S3-09](BUGS.md#s3-09)). |
| "make this screen tidy" | 12:15:14Z, 200, 9.7 s | `tidyLayout` | Overlaps 4 -> 3 (2920 -> 1240 px²), out of bounds 0 -> 0. START/STOP **not** aligned: dMiddleY stays 10, because tidy only separates overlaps. The 3 overlaps inside Tank 101 remain and were reported as done. **Partly done.** |

No 429s on the chat path. The agent path's failures are Gemini 503s, at the times above.

**Verdict.**
- Chat: **partly works.** Align (1 of 1) and removing a named overlap (1 of 1) gave measurably right geometry on flash-lite.
- "Tidy" is overlap-only. It is blind to overlaps inside a faceplate and does not align, distribute, match size, snap or fix out-of-bounds parts.
- Agent: **does not work for alignment today.** It has no geometry tools, and every run measured here was stopped by Gemini 503s before it reached one.
- Not measured: alignment through MCP `apply_ops`. It uses the same ops as chat, so it is expected to behave the same.

Shaurya's belief is half right. The chat's `alignObjects` and `tidyLayout` do work for the plain cases. Everything else (match size, snap, out of bounds, overlaps inside a card, and the agent) does not exist or does not run.

## Live sync

### Server side

| Capability | Status | Evidence |
|---|---|---|
| Token minting only for people who can read the project | **yes** | realtime-token/route.ts:26-31 (requireReader + identity); token.ts:97-107; tests/realtime.test.ts. Prod: unauthenticated GET -> 404/401, never a token. |
| Token scope and life | **yes** | Claim `project_topic: project:<id>`, role/aud `authenticated`, sub user id, 15 min (token.ts:49,74-104); ES256 with kid or legacy HS256 (config.ts:186-204). |
| Topic authorisation (policy) | **partly** | SELECT limited to the claimed topic (migration :39-44). INSERT also allowed, so any token holder (viewers included) can broadcast on the topic ([S2-11](BUGS.md#s2-11)). Cross-project refusal is covered by `npm run realtime:check` (not run by this audit: no Supabase credentials used). |
| Revocation | **partly** | Removing a member stops the next mint; an existing token keeps working up to 15 min (documented, token.ts:7-8); an open SSE connection keeps streaming up to 55 s (stream route checks once). |
| Server announces every revision | **no** | Only POST /changes publishes; proposal accept, PUT save, restore and MCP writes do not ([S2-04](BUGS.md#s2-04), test fails). |
| Proposals and agent steps on Realtime | **no** | They exist only as SSE events (stream/route.ts:28); Realtime sessions get revisions only (realtime.ts:246). S4 covers the UI consequence. |
| SSE stream route auth | **yes** | requireReader (stream/route.ts:23); viewer-link visitors may listen; their agent-step events are filtered to the holder (proposals.ts:175-177). Leaks project existence to strangers ([S2-09](BUGS.md#s2-09)). |
| SSE fallback when Realtime is off or refused | **yes** | transport.ts:293-295; realtime.ts:220-235; tests/realtime-fixes.test.ts "a session whose token is refused". |
| Presence | **yes** | Heartbeat route with server-decided names, 15 s TTL (presence/route.ts:24-44, repo-live.ts:184-200); anonymous beats dropped. On Realtime, anonymous viewers see no presence (sync.ts:189 sends only with an author). |
| Keep-alive cron | **yes** | CRON_SECRET bearer, fails closed (keepalive/route.ts:30-39); prod GET -> 401. Whether it keeps the Free project awake is unverified (REALTIME_SETUP.md §6). |
| Two browsers past 60 s on prod | **not verified** | Needs two prod accounts; none exists. |

Verdict: **partly**. Minting and read authorisation are sound; the channel is write-open to readers, and four of
the five write paths never announce, so Realtime sessions miss changes that SSE sessions see.

### UI side

**Partly.**

Works:
- Two signed-in tabs on one local project (Supabase configured). A 2-unit nudge of the banner in tab 1 was visible in tab 2 when switched to (tab 2 log: `GET /changes?since=4`, then `since=5`, fetched at 44.5 s, right after the edit, not on a timer).
- A signed-out viewer on a share link gets `realtime-token → 401`, falls back to the event stream, and saw the owner's nudge (y 2.5 → 3.5) at once.
- Presence heartbeats every 5 s (measured).

Does not work:
- Server-side results (Copilot builds, proposals, agent steps) never arrive over the Realtime transport ([S4-22](BUGS.md#s4-22)).
- An accepted proposal does not reach even the accepting tab ([S4-24, merged into S2-04](BUGS.md#s2-04)).
- The chat is not synced or saved in a live project ([S4-23](BUGS.md#s4-23)).
- The same user in two tabs shows no presence (keyed by user id).
- The console logs "Multiple GoTrueClient instances detected" (11 instances in one session): a Supabase client per session start.

Not verified on prod (no prod account).

## Comments, share links, history and undo, export

### Comments

**Yes, with polling.**
- Owner pins a comment on an object (pin 1, "#Banner").
- A commenter (throwaway account via commenter link) replies.
- A signed-out viewer reads the threads.
- Resolve is offered.
- Updates are a 10 s poll (measured: comments GET at 10.1, 20.2, 30.2, 40.2 s), not push.
- No editing of a comment, and no project-wide open-threads list (GAP-6).

### Share links

**Yes.**
- Viewer link: works signed out; read-only canvas, inspector and comments.
- Commenter link: asks to sign in or sign up and returns to the link; membership is added.
- Copy and revoke are listed.
- Issues: export defaults on for commenter and editor links ([S4-18](BUGS.md#s4-18)); no invite by name; read-only members trigger a 403 save and a false "Offline" status ([S4-19](BUGS.md#s4-19)).

### History and undo

**Partly.**
- Undo and redo work per edit, and a chat turn is one undo step (LLD F7; store tests).
- Wrong: the undo snapshot omits composites ([S4-07](BUGS.md#s4-07)).
- Versions: restore of the oldest of 20 is a no-op ([S4-02](BUGS.md#s4-02)); restore drops objectMeta ([S4-08](BUGS.md#s4-08)); versions are per device; an opened .eote starts with "No versions yet" (flow 3 step 14); "Versions live in this session" is inaccurate.

### Export

**Yes for the files; partly for the claims.**
- Local and commenter (allowExport) exports produce a zip with the .eote (24.6 KB), Variables.csv, the report and a README (flow 1 step 9, flow 3 step 13).
- Wrong: the CSV includes placeholders for screens-first projects ([S4-06](BUGS.md#s4-06)); a "verified" badge on every export; the README says nothing was hand-drawn ([S4-17](BUGS.md#s4-17)).
- Whether OTE opens the result: not verified (no OTE here).
