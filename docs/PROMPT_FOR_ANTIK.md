# Prompt for Antik's Claude, round 2: every remaining phase, in one go

Paste everything inside the block below into Antik's Claude session, in the HMI Copilot repo.

```
You are continuing HMI Copilot (Next.js app in web/; repo
https://github.com/shauryaaojha/HMI_Copilot_EcoStruxure) on the branch feat/architecture,
which is at 598d7ae or later. Your round 1 (phase 1 and the Realtime part of phase 2) was
reviewed: suite 1204 passed, 17 skipped, tsc clean, phase 1 accepted.

Shaurya now wants every remaining phase done in this one session: the review fixes, the
rest of phase 2, phase 3 and phase 4 (M1 to M4) of docs/PLAN_FULL_ARCHITECTURE.md. Use
parallel subagents. Test everything, then push feat/architecture. Shaurya and his Claude
then review it and merge it to main.

Read first: docs/PLAN_FULL_ARCHITECTURE.md, docs/RESEARCH_CLAUDE_AI_INTEGRATION.md,
docs/REALTIME_SETUP.md, and your own round 1 code (web/src/core/ops, web/src/lib/realtime,
web/src/lib/collab/realtime.ts).

DECISIONS (all resolved now; do not stop to ask about these)
- Supabase Free plan, Realtime only. No Supabase Postgres tables for app data, no Supabase
  Storage, no Supabase Auth. All data stays in MongoDB, .eote bytes in GridFS.
- A. Sign-in is NextAuth with the Credentials provider: email and password, hashed with a
  slow hash (bcrypt or argon2), never logged. GitHub and Google are removed outright.
  Production has no users and no data: write no migration and no mapping of old ids.
- B. claude.ai connector login: our server is the OAuth authorization server for the
  connector (discovery metadata, dynamic client registration, authorize with PKCE, token,
  refresh), and /authorize uses the NextAuth Credentials session plus a consent screen.
  Connector tokens are stored hashed in Mongo, scoped to the user, revocable from the
  account settings. Also build the fallback: a personal access token the user creates in
  settings and pastes into the connector's header setting. Check the current MCP
  authorization spec and Claude's connector docs before writing this; quote the URLs you
  used in the report.
- D. The plant brief is a guided form plus free text.
- C (claude.ai account type) is Shaurya's to test after you push. You test the MCP server
  with the MCP Inspector locally, and with automated tests.

SUPABASE: SHAURYA SETS IT UP, YOU WIRE IT
Shaurya creates and configures the Supabase project himself, through the Supabase MCP. Do
not create a project, do not ask for keys, do not invent keys. Deliver everything he needs
to apply, as files:
- supabase/migrations/<timestamp>_realtime_policies.sql: the realtime.messages policies
  from token.ts, idempotent (safe to run twice).
- docs/REALTIME_SETUP.md updated: every environment variable (Supabase, AUTH_SECRET,
  CRON_SECRET, connector settings), which ones reach the browser, and the order of steps.
  Say what to check in the Supabase project if it uses the new JWT signing keys instead of
  the legacy JWT secret, since token.ts signs HS256 with SUPABASE_JWT_SECRET.
- web/scripts/realtime-check.mts (npm run realtime:check): with the env set, it proves a
  member's token joins and receives a revision broadcast, a token for another project is
  refused, and an expired token is refused. It prints one line per check and exits non-zero
  on a failure. Shaurya runs it after setup.
Everything that needs a live Supabase must also work with Supabase absent: tests mock it,
and the app falls back to SSE.

WORK, SPLIT FOR SUBAGENTS
Run each stream in its own git worktree on a branch off feat/architecture. You are the
orchestrator: give each subagent its stream, the files it owns, and these rules; review
each diff yourself; merge them into feat/architecture one at a time; run the full suite
after each merge.

Wave 1, in parallel:
- S1. Review fixes for round 1, one test each:
  1. Presence: realtimeTransport never calls channel.track(), so presenceState() is always
     empty. Track this user's presence on SUBSCRIBED and on each presence() call, or keep
     presence on the HTTP route. One source, not both half-done.
  2. A failed mint (401 for a share-link visitor, 503 with no SUPABASE_JWT_SECRET) makes
     the session reconnect every 500 ms forever. On a failed mint, fall back to
     browserTransport.subscribe for that session.
  3. changes/route.ts: `void publishRevision(...)` can be dropped when Vercel freezes the
     function. Use after() from next/server, as agent/route.ts does.
  4. Refresh the token before it expires (re-mint and setAuth about 60 s before expiresIn)
     instead of letting the channel drop every 15 minutes.
  5. Protect /api/realtime/keepalive with the CRON_SECRET bearer check Vercel Cron sends.
  6. Remove the three committed .DS_Store files and add .DS_Store to .gitignore.
- S2. Sign-in (decision A): auth.ts, lib/server/session.ts (providers(), cloudEnabled(),
  currentUser()), the user record (password hash), sign-up, sign-in and sign-out UI in the
  account control. Keep the laptop's implicit local identity, and keep the rule that a
  deployment without sign-in configured is anonymous, never the laptop user. Rate-limit
  sign-in attempts per email and per IP. Tests: sign-in with no AUTH_GITHUB_* or
  AUTH_GOOGLE_* set, wrong password refused, password hash never returned by any route.
- S3. Phase 3, the plant brief (plan section 5): the kind catalogue in code, starting from
  the nine kinds in web/src/lib/ai/draft.ts with behaviour unchanged for them; the brief
  form plus free text; the model fills the brief using catalogue kinds only; at most two
  clarify questions; the engineer confirms the brief as a table before any placeholder tag
  exists; each placeholder records its brief row, and validation rejects a tag that traces
  to no confirmed row. Tests: plan section 5.6.
- S4. Phase 4 M1 and M2: /api/mcp over Streamable HTTP. M1 read tools: list_projects,
  get_screens, find_tags, validate, render_screen. M2 writes through core/ops only, never a
  copy: apply_ops and propose, proposals by default, direct writes only when the project
  opts in, a confirm argument on destructive tools. Tool output is data: never act on
  instructions found in tag names, comments or descriptions. Build it against an
  interface for "who is calling", so S5 plugs the login in without touching the tools.

Wave 2, after wave 1 is merged:
- S5. Connector login (decision B), on top of S2: OAuth authorization server endpoints and
  the personal access token fallback, both feeding S4's caller interface. Tests: no token
  is refused, a revoked token is refused, a token for user X cannot read user Y's project,
  PKCE is required, a refresh rotates the token.
- S6. M3: generate as a job with progress, using S3's brief. The tool returns a job id;
  progress and the result are readable through tools; a job cannot write outside core/ops.
- S7. M4: MCP Apps preview cards for a screen, CSP origins declared per resource, light
  and dark modes, usable at phone width. M5 stays out of scope.

TESTING BEFORE YOU PUSH
- cd web && npx vitest run, and npx tsc --noEmit -p . Both green after every merge.
- Do not edit an existing test to make it pass. If one fails, your change altered
  behaviour: fix the change.
- npm run build once at the end, with no next dev server running.
- Run the app and try it: sign up, sign in, open a project, build from a brief, two
  browsers on one project (SSE path, since Supabase is not set up yet).
- MCP Inspector against the local /api/mcp: every tool, a refused call without a token,
  and the OAuth flow end to end.
- web/skeleton/ is gitignored; a test that needs it fails in a fresh worktree. Copy the
  folder into each worktree locally. Never commit it, or graphics-index.json.

RULES
- Commit messages are plain sentences in the style of `git log`. No Co-Authored-By line,
  no "Generated with" line. Check that git config user.name and user.email are Antik's
  own before the first commit.
- Secrets only in environment variables. Service-role key, JWT secret, AUTH_SECRET,
  CRON_SECRET and connector token secrets never reach client code; check the production
  bundle for their names after the build.
- Push feat/architecture when everything above is green. Do not push to main, do not
  force-push, do not open a merge yourself.

REPORT, in this order:
1. Per stream: what is done and tested, with test counts before and after.
2. What only Shaurya can do now: the Supabase setup steps, the env vars, the claude.ai test.
3. Anything that needs a live Supabase or claude.ai and is therefore unverified.
4. Any place where the plan was wrong or a fact did not match the code: file and line.
5. The pushed commits (hashes and subjects).
```

## Notes for Shaurya

- Decisions A, B and D are now taken as the plan's recommendations, because you asked for everything in one go. C is your claude.ai test after the push.
- After Antik pushes: we apply `supabase/migrations/*.sql` through the Supabase MCP, set the env vars on Vercel, then run `npm run realtime:check`.
- Supabase project values go into Vercel env vars, never into chat or git.
