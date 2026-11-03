# Supabase Realtime: what to set up once the project exists

*Phase 2 of `docs/PLAN_FULL_ARCHITECTURE.md`. The code is merged and behind a
flag; none of the live-sync part runs until the Supabase variables below are
set. Written 2026-10-30, rewritten the same day after the first review.*

Supabase is used for one thing: live sync. No Postgres tables, no Storage, no
Supabase Auth (decision 1). Project data, membership included, stays in
MongoDB (decision 3).

---

## 1. Every environment variable the app reads

Set these in Vercel, or in `web/.env.local` on a laptop; never in git. Nothing
in the repository contains a key.

Anything named `NEXT_PUBLIC_*` is compiled into the browser bundle and is
public the moment it is set. That is deliberate for two Supabase values and
must never be done to any of the others. Everything else below is server-only:
read in a route handler, or in a library that only route handlers import.

### Live sync — the subject of this document

| Variable | Read by | Reaches the browser? | What it is for |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `web/src/lib/realtime/config.ts` | **yes, by design** | the flag: Realtime stays off until this and the next are both set |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `web/src/lib/realtime/config.ts` | **yes, by design** | opening the WebSocket. The `sb_publishable_...` key. The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is still read when this is unset |
| `SUPABASE_JWT_PRIVATE_KEY` | `web/src/lib/realtime/token.ts` | no | signing each short-lived, one-project token: an ES256 private JWK, one line of JSON, imported into Supabase as a signing key (§5). The legacy `SUPABASE_JWT_SECRET` (HS256) is still read when this is unset |
| `SUPABASE_SECRET_KEY` | `web/src/lib/realtime/publish.ts` | no | the server's revision broadcast. The `sb_secret_...` key. The legacy `SUPABASE_SERVICE_ROLE_KEY` is still read when this is unset |
| `CRON_SECRET` | `web/src/app/api/realtime/keepalive/route.ts` | no | the keep-alive cron. **Unset means the keep-alive refuses everything, the cron included**: it fails closed, because an open route that spends the project's message quota is a route a stranger can spend |

With only the public pair set, browsers try Realtime while the server can
neither mint nor publish, so every session falls back to the event stream. Set
the four Supabase values together.

### Identity, storage and the model

Live sync leans on identity more than it looks. A token is minted for a
signed-in person; a share-link visitor with no identity gets a 401 from the
mint route and keeps the event stream. On Vercel with no provider configured,
nobody has an identity, so nothing mints and Realtime never runs at all.

| Variable | Read by | Reaches the browser? | What it is for |
|---|---|---|---|
| `AUTH_SECRET` | `web/src/lib/server/session.ts` | no | signing Auth.js sessions. It is also the switch for accounts: set, people sign up and sign in with an email and a password; unset on a deployment, nobody can sign in |
| `AUTH_URL` | Auth.js | no | optional: a canonical URL behind a reverse proxy |
| `AUTH_TRUST_HOST` | Auth.js | no | optional: only behind a trusted proxy; Vercel is inferred |
| `MONGODB_URI` | `web/src/lib/db/mongo.ts` | no | every project, membership and the operation log |
| `MONGODB_DB` | `web/src/lib/db/mongo.ts` | no | optional; defaults to `hmi_copilot` |
| `AI_PROVIDER` | `web/src/lib/ai/provider.ts` | no | `claude`, `gemini` or `none`. The provider is chosen here, never by which key happens to be set |
| `AI_MODEL` | `web/src/lib/ai/provider.ts` | no | optional override of the provider's default model id |
| `ANTHROPIC_API_KEY` | `web/src/lib/ai/provider.ts` | no | Claude |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `web/src/lib/ai/provider.ts` | no | Gemini |
| `CRITIC_DEBUG` | `web/src/lib/critic/critic.ts` | no | optional: prints the critic's raw answer to the server log |
| `KNOWLEDGE_STORE`, `KNOWLEDGE_DIR` | `web/src/lib/knowledge/store.ts` | no | optional: where scanned project knowledge is kept |
| `OTE_INSTALL_DIR` | `web/scripts/extract-skeleton.mjs` | no | scripts only, on a machine with EcoStruxure installed |
| `VERCEL` | several | no | **set by the host.** Never set it by hand: locally it removes the implicit local engineer and leaves nobody signed in |

### The claude.ai connector — owned by another stream

<!-- OWNER: the connector stream. The names are theirs; do not guess them. -->

The MCP connector that lets claude.ai drive the app will need settings of its
own (at least an endpoint and something to authorize a caller with). They are
deliberately **not listed here and must not be invented**: the stream building
the connector names them, and this table takes one row per name when it lands.

| Variable | Read by | Reaches the browser? | What it is for |
|---|---|---|---|
| _to be named by the connector stream_ | | | |

---

## 2. The order to do it in

1. **Create the Supabase project.** Any region. Nothing needs to be created
   inside it: no tables, no buckets, no auth providers.
2. **Copy the API keys** from *Project Settings → API Keys*, the *Publishable
   and secret API keys* tab: the publishable key becomes
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, a secret key becomes
   `SUPABASE_SECRET_KEY`, and the project URL `NEXT_PUBLIC_SUPABASE_URL`. Use
   these rather than the legacy `anon` and `service_role` keys, which Supabase
   retires at the end of 2026.
3. **Make and import a signing key** (§5). It becomes
   `SUPABASE_JWT_PRIVATE_KEY`.
4. **Apply the policies.** Run
   `supabase/migrations/20261030170741_realtime_policies.sql` from this
   repository in the SQL editor (or `supabase db push` with the CLI linked, or
   the Supabase MCP's `apply_migration`). It is idempotent: running it twice
   leaves the same two policies. It does not switch RLS on, because on a hosted
   project the table is not ours to alter; confirm it is on with
   `select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass;`.
5. **Invent a `CRON_SECRET`** — a random string of at least 16 characters — and
   set it in Vercel. Vercel then sends it as `Authorization: Bearer <value>` on
   every cron invocation, and the keep-alive accepts nothing else.
6. **Set all five in Vercel**, Production and Preview, then **redeploy**:
   `NEXT_PUBLIC_*` values are compiled in at build time, so a running
   deployment will not pick them up.
7. **Run the acceptance check** from `web/`, with the same variables exported
   in the shell or sitting in `web/.env.local`:

   ```
   npm run realtime:check
   ```

   One line per property, non-zero exit if any of them fails:

   - a member's minted token joins the project channel and receives a revision
     broadcast;
   - a token minted for a *different* project is refused on this project's
     topic — the case the mint route cannot refuse, so only the policy can;
   - an expired token is refused;
   - a broadcast sent with the publishable key alone does not reach a member.
     The REST endpoint answers 202 to it whether or not it is delivered, so
     only a listener can tell.

   With the variables unset it names the ones it is missing and stops.
8. **Then two browsers.** Two signed-in members on one project: an edit in one
   appears in the other inside a second, and keeps doing so well past a minute.
   That last part is the point of all this — a Vercel function may run 60 s, so
   every event stream was cut at 55 and reopened.

---

## 3. The policies, and why they are a claim

The file in step 4 is the whole of the Supabase-side configuration.

Supabase's documented pattern joins a table of memberships. We have none:
membership lives in MongoDB, and the server has already decided it by the time
it mints a token. So the decision travels in the token as a claim, and the
policy checks the topic being joined against that claim.

```sql
create policy "a token may only join the topic it names"
on realtime.messages for select to authenticated
using ( realtime.topic() = (auth.jwt() ->> 'project_topic') );

create policy "a token may only broadcast on the topic it names"
on realtime.messages for insert to authenticated
with check ( realtime.topic() = (auth.jwt() ->> 'project_topic') );
```

`select` is receiving a broadcast; `insert` is sending one. A non-member never
gets a token, so never a claim, so never a match. `aud` and `role` are both
`authenticated` in the minted token because Realtime reads them to assume a
database role *before* any policy is evaluated: a token without them is
refused before the policy runs.

**Presence is not on the channel.** It stays on
`POST /api/projects/[id]/presence`, which stores a heartbeat in Mongo with a
15-second expiry and answers with everyone currently there. The names and ids
shown are the server's, decided from the session rather than taken from a
browser's word for who it is, and the expiry that makes a closed laptop
disappear has nowhere to live on a channel. One source of truth, and the
channel carries revision notices only.

---

## 4. Keeping a Free project awake

A Free project pauses after a week of inactivity, and a paused project refuses
Realtime connections. Whether Realtime traffic alone counts as activity is
unverified, so `web/vercel.json` runs a cron every three days at 06:00 UTC
against `/api/realtime/keepalive`, which opens a channel — activity we
control. If Realtime traffic turns out to count, the cron can go.

Two things to know:

- the route refuses any request without the cron's bearer token, and refuses
  everything when `CRON_SECRET` is unset. A cron that starts answering 401 has
  a missing secret, or a changed one with no redeploy since;
- on the Hobby plan a cron may run only once a day, and Vercel may fire it
  anywhere within the scheduled hour.

---

## 5. The signing key: ours, imported into Supabase

The server mints its own Realtime tokens, because the authorization is a claim
we put there (§3). Supabase's *JWT signing keys* cannot be read back out of the
dashboard - its own docs: "Once you've moved to using the JWT signing keys
feature extracting of the private key or shared secret from Supabase is not
possible" - so the server signs with a key of its own, and Supabase is told to
trust it.

1. **Make the key.** An ES256 (P-256) private JWK with a `kid`:

   ```
   node --input-type=module -e 'import{generateKeyPair,exportJWK}from"jose";import{randomUUID}from"node:crypto";const{privateKey}=await generateKeyPair("ES256",{extractable:true});console.log(JSON.stringify({...await exportJWK(privateKey),kid:randomUUID(),alg:"ES256"}))'
   ```

   (run in `web/`, where `jose` is installed; `supabase gen signing-key
   --algorithm ES256` does the same). The output is the private key: it goes
   to Supabase and to the deployment's environment, and nowhere else.
2. **Import it.** *Project Settings → JWT Keys*
   (`https://supabase.com/dashboard/project/_/settings/jwt`) → *Create standby
   key* → import an existing private key → paste the JSON.
3. **Rotate to it.** *Rotate keys*. A standby key is not yet trusted: only the
   current key, and previously used keys until they are revoked, verify. The
   rotation also makes it the key Supabase Auth signs with, which changes
   nothing here, because this app does not use Supabase Auth. Key changes are
   throttled for about five minutes.
4. **Set `SUPABASE_JWT_PRIVATE_KEY`** to the same one line of JSON.

`token.ts` signs ES256 with the key's `kid` in the header, which is how
Supabase finds the public half. A `kid` that does not match the imported key
is refused at the join, which is exactly what `npm run realtime:check` reports
before step 3 is done.

**Legacy projects.** With no `SUPABASE_JWT_PRIVATE_KEY` set, `token.ts` signs
HS256 with `SUPABASE_JWT_SECRET`, which works for as long as the project still
trusts its legacy JWT secret. Supabase is retiring that system, so a new setup
should not start there.

**Rotating ours.** Make a new key, import it as standby, rotate, set the new
JSON and redeploy, then revoke the old key once 15 minutes (a token's life)
have passed.

Sources, checked 2026-11-03:
<https://supabase.com/docs/guides/auth/signing-keys>,
<https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys>,
<https://supabase.com/docs/guides/realtime/authorization>.

---

## 6. What is still unverified

`npm run realtime:check` now covers what used to be the first two items here —
a member joins and hears a revision, and a token for another project is refused
by the policy rather than by the route. What a machine still cannot answer:

1. **Two browsers, past the old 60-second cut-off** (step 8).
2. **Whether Realtime traffic counts as activity** for the Free plan's
   one-week pause (§4).

---

## 7. If the project pauses anyway

Unset `NEXT_PUBLIC_SUPABASE_URL` and redeploy. Every session falls back to the
event stream on the next load — the behaviour the app had before phase 2, still
covered by its own tests. A single session that cannot get a token already does
this by itself, without anyone changing a variable. That is the whole of the
rollback.
