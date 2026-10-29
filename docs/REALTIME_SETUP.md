# Supabase Realtime: what to set up once the project exists

*Phase 2 of `docs/PLAN_FULL_ARCHITECTURE.md`. The code is merged and behind a
flag; none of it runs until the four variables below are set. Written
2026-10-30.*

Supabase is used for one thing: live sync. No Postgres tables, no Storage, no
Supabase Auth (decision 1). Project data, membership included, stays in
MongoDB (decision 3).

---

## 1. Environment variables

Four, set in Vercel rather than in git. Nothing in the repository contains a
key, and `realtimeEnabled()` stays false until the first two are present.

| Variable | Where it is read | Reaches the browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/realtime/config.ts` | yes, by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/realtime/config.ts` | yes, by design |
| `SUPABASE_JWT_SECRET` | `lib/realtime/token.ts`, to sign | **no** |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/realtime/publish.ts`, to broadcast | **no** |

The last two are server-only. `publish.ts` is imported by two route handlers
and nothing else, and the production bundle was checked for the name after the
build.

With only the public pair set, browsers try Realtime but the server cannot
mint or publish. Set all four together.

---

## 2. The policy to apply

Run once, in the Supabase SQL editor.

Supabase's documented pattern joins a table of memberships. We have none:
membership lives in MongoDB, and the server has already decided it by the time
it mints a token. So the decision travels in the token as a claim, and the
policy checks the topic being joined against that claim.

```sql
-- A token carries project_topic, set by the server after it checked in Mongo
-- that this person may read this project. A non-member never gets a token.

create policy "a token may only join the topic it names"
on realtime.messages for select to authenticated
using ( realtime.topic() = (auth.jwt() ->> 'project_topic') );

create policy "a token may only broadcast on the topic it names"
on realtime.messages for insert to authenticated
with check ( realtime.topic() = (auth.jwt() ->> 'project_topic') );
```

`aud` and `role` are both set to `authenticated` in the minted token because
Realtime reads them to assume a database role before any policy is evaluated.
A token without them is refused before the policy runs.

---

## 3. What is still unverified

These need a real project and cannot be checked from the test suite. They are
the phase 2 checkpoint.

1. **Two browsers see each other's revisions within a second**, with no 60
   second cut-off. The cut-off is what Realtime is for: a Vercel function may
   run 60 s, so every event stream was closed at 55 and reopened.
2. **A non-member receives nothing.** Sign in as someone with no access to the
   project and confirm the channel join is refused. The token route refuses
   first, so also try joining the topic with a token minted for a *different*
   project: the policy should refuse that too, and this is the case that tests
   the policy rather than the route.
3. **Whether Realtime traffic counts as activity** for the Free plan's
   one-week pause. Until that is known, the keep-alive cron in `vercel.json`
   runs every three days at 06:00 UTC and calls `/api/realtime/keepalive`.
   If Realtime traffic does count, the cron can go.

---

## 4. If the project pauses anyway

Unset `NEXT_PUBLIC_SUPABASE_URL`. Every session falls back to the event stream
on the next load, which is the behaviour the app had before phase 2 and which
is still covered by its own tests. That is the whole of the rollback.
