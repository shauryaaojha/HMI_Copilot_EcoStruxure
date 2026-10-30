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
-- These two policies are the other half of that: the topic being joined must
-- be the topic the token names. A non-member never gets a token, so they never
-- get a claim, so they never match. Someone holding a token for project A
-- cannot use it on project B's topic, which is the case the route cannot
-- refuse and only the policy can - and the case `npm run realtime:check`
-- exercises (web/scripts/realtime-check.mts).
--
-- SELECT is receiving a broadcast; INSERT is sending one. Both are needed: a
-- client that may only receive cannot broadcast its own notices, and the
-- server publishes with the service-role key, which is not subject to RLS.
--
-- Safe to run twice: each policy is dropped if it is there before it is
-- created, so re-running this file leaves exactly the two policies below.

-- Realtime ships with RLS on realtime.messages, but a project that has been
-- through a restore may not; without it the policies below are never consulted.
alter table if exists realtime.messages enable row level security;

drop policy if exists "a token may only join the topic it names" on realtime.messages;
create policy "a token may only join the topic it names"
on realtime.messages
for select
to authenticated
using ( realtime.topic() = (auth.jwt() ->> 'project_topic') );

drop policy if exists "a token may only broadcast on the topic it names" on realtime.messages;
create policy "a token may only broadcast on the topic it names"
on realtime.messages
for insert
to authenticated
with check ( realtime.topic() = (auth.jwt() ->> 'project_topic') );
