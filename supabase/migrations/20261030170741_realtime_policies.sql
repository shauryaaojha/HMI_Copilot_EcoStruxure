-- Channel authorization for live sync.
--
-- Supabase is used for Realtime and nothing else: no tables of ours, no
-- Storage, no Supabase Auth (docs/PLAN_FULL_ARCHITECTURE.md §0). Membership
-- lives in MongoDB, so the documented pattern - an RLS policy that joins a
-- memberships table - has no table to join here.
--
-- Instead the server decides access when it mints a token
-- (web/src/lib/realtime/token.ts): it checks in Mongo that this person may
-- read this project, then signs a short-lived token carrying
--
--   role          = authenticated   Realtime assumes a database role from it
--                                   before any policy runs
--   aud           = authenticated   same
--   sub           = the user id
--   project_topic = project:<id>    the one topic this token may use
--
-- This policy is the other half of that: the topic being joined must
-- be the topic the token names. A non-member never gets a token, so they never
-- get a claim, so they never match. Someone holding a token for project A
-- cannot use it on project B's topic, which is the case the route cannot
-- refuse and only the policy can - and the case `npm run realtime:check`
-- exercises (web/scripts/realtime-check.mts).
--
-- SELECT is receiving a broadcast; INSERT is sending one. Browsers only receive:
-- the server publishes with the secret key (the service role), which is not
-- subject to RLS. There is deliberately no INSERT policy, because with one any
-- token holder could send notices on the topic (audit S2-11, dropped 2026-11-06).
--
-- Safe to run twice: re-running this file leaves exactly the one policy below.
--
-- No `alter table ... enable row level security`: realtime.messages belongs
-- to Supabase's realtime admin role, so on a hosted project that statement
-- fails with "must be owner of table messages" and takes the whole migration
-- with it (seen applying this on 2026-11-03). RLS is on there by default;
-- docs/REALTIME_SETUP.md has the query that confirms it.

drop policy if exists "a token may only join the topic it names" on realtime.messages;
create policy "a token may only join the topic it names"
on realtime.messages
for select
to authenticated
using ( realtime.topic() = (auth.jwt() ->> 'project_topic') );

drop policy if exists "a token may only broadcast on the topic it names" on realtime.messages;
