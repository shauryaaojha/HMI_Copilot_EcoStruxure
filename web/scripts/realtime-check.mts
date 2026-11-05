/**
 * The Realtime acceptance check, run once against a real Supabase project.
 *
 *   npm run realtime:check
 *
 * This is the phase 2 checkpoint in docs/REALTIME_SETUP.md, the part the test
 * suite cannot reach: the suite runs on a machine with no Supabase project, so
 * it can prove what the server signs and what the client does with it, but
 * never that Supabase agrees. Five things are proved here, one line each:
 *
 *   1. a member's minted token joins the project channel and receives a
 *      revision broadcast - the policy lets the right token in;
 *   2. a token minted for a different project is refused on this topic - the
 *      policy, not the mint route, is what refuses it (the route would have
 *      refused long before, which is why the token here is minted by hand);
 *   3. an expired token is refused - access ends by itself;
 *   4. a broadcast sent with the public key alone does not reach a member -
 *      the publishable key is in every browser, so if it could publish, any
 *      visitor could ring every project's bell. Realtime's REST endpoint
 *      answers 202 to it either way, so only a listener can tell;
 *   5. a member's own token cannot send on its topic - a viewer, or someone
 *      removed in the last 15 minutes, must not be able to ring the bell.
 *
 * It needs no project in MongoDB: a token's topic claim is signed by us and
 * checked by the policy, so a made-up project id exercises exactly the same
 * path a real one does.
 *
 * Exits 0 only when all five pass, so it can be the last step of a setup
 * script. When the environment is incomplete it says which variables are
 * missing and exits 1 - never a stack trace.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import {
  envComplaint,
  exitCode,
  expiredToken,
  joinOutcome,
  missingEnv,
  readResults,
  type CheckResult,
} from "../src/lib/realtime/check.js";
import { publicConfig, REVISION_EVENT, signingConfig, topicFor } from "../src/lib/realtime/config.js";
import { mintRealtimeToken } from "../src/lib/realtime/token.js";
import { publishRevision } from "../src/lib/realtime/publish.js";

/** How long any one join or broadcast is waited for. */
const WAIT_MS = 15_000;

/** The same .env.local the app reads, so the keys are in one place. */
async function loadEnv() {
  const text = await readFile(join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  for (const row of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(row);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

/** A client that speaks as whoever the token says, and nothing else. */
async function clientFor(token: string): Promise<SupabaseClient> {
  const { url, anonKey } = publicConfig()!;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await client.realtime.setAuth(token);
  return client;
}

/** Leave the channel and close the socket, so the script does not hang on exit. */
async function hangUp(client: SupabaseClient, channel: RealtimeChannel) {
  await client.removeChannel(channel).catch(() => undefined);
  await client.realtime.disconnect();
}

/** 1. The right token joins, and hears a revision that landed after it joined. */
async function memberHearsRevision(projectId: string, userId: string): Promise<CheckResult> {
  const name = "a member's token joins and hears a revision";
  const minted = await mintRealtimeToken(userId, projectId);
  if (!minted) return { name, ok: false, detail: "the server would not mint a token; check SUPABASE_JWT_PRIVATE_KEY" };
  const client = await clientFor(minted.token);
  const channel = client.channel(minted.topic, { config: { private: true } });
  const heard: unknown[] = [];
  channel.on("broadcast", { event: REVISION_EVENT }, (message) => {
    heard.push((message.payload as { rev?: unknown })?.rev);
  });
  try {
    const outcome = await joinOutcome(channel, WAIT_MS);
    if (outcome !== "joined") return { name, ok: false, detail: `the join was ${outcome} on ${minted.topic}` };
    const sent = await publishRevision({ projectId, rev: 41, author: userId });
    if (!sent) return { name, ok: false, detail: "the publish was not accepted; check SUPABASE_SECRET_KEY" };
    const deadline = Date.now() + WAIT_MS;
    while (heard.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    if (heard.length === 0) return { name, ok: false, detail: `joined ${minted.topic} but no broadcast arrived in ${WAIT_MS / 1000}s` };
    return { name, ok: true, detail: `joined ${minted.topic} and heard revision ${heard[0]}` };
  } finally {
    await hangUp(client, channel);
  }
}

/** 2. A token for another project is refused on this project's topic. */
async function otherProjectRefused(projectId: string, userId: string): Promise<CheckResult> {
  const name = "a token for another project is refused here";
  const other = await mintRealtimeToken(userId, `${projectId}-elsewhere`);
  if (!other) return { name, ok: false, detail: "the server would not mint a token; check SUPABASE_JWT_PRIVATE_KEY" };
  const topic = topicFor(projectId);
  const client = await clientFor(other.token);
  const channel = client.channel(topic, { config: { private: true } });
  try {
    const outcome = await joinOutcome(channel, WAIT_MS);
    if (outcome === "joined") return { name, ok: false, detail: `it joined ${topic}, so the policy is not comparing project_topic` };
    if (outcome === "timeout") return { name, ok: false, detail: `no answer for ${topic} in ${WAIT_MS / 1000}s; nothing was proved` };
    return { name, ok: true, detail: `${other.topic} was refused ${topic}` };
  } finally {
    await hangUp(client, channel);
  }
}

/** 3. An expired token is refused, so access ends without anyone revoking it. */
async function expiredRefused(projectId: string, userId: string): Promise<CheckResult> {
  const name = "an expired token is refused";
  const token = await expiredToken(signingConfig()!, userId, projectId);
  const topic = topicFor(projectId);
  const client = await clientFor(token);
  const channel = client.channel(topic, { config: { private: true } });
  try {
    const outcome = await joinOutcome(channel, WAIT_MS);
    if (outcome === "joined") return { name, ok: false, detail: `an expired token joined ${topic}` };
    if (outcome === "timeout") return { name, ok: false, detail: `no answer for ${topic} in ${WAIT_MS / 1000}s; nothing was proved` };
    return { name, ok: true, detail: `the expired token was refused ${topic}` };
  } finally {
    await hangUp(client, channel);
  }
}

/** 4. The public key alone cannot publish: a member hears the real notice and not the forged one. */
async function publicKeyCannotPublish(projectId: string, userId: string): Promise<CheckResult> {
  const name = "a broadcast sent with the public key alone does not arrive";
  const minted = await mintRealtimeToken(userId, projectId);
  if (!minted) return { name, ok: false, detail: "the server would not mint a token; check SUPABASE_JWT_PRIVATE_KEY" };
  const client = await clientFor(minted.token);
  const channel = client.channel(minted.topic, { config: { private: true } });
  const heard: unknown[] = [];
  channel.on("broadcast", { event: REVISION_EVENT }, (message) => {
    heard.push((message.payload as { rev?: unknown })?.rev);
  });
  try {
    const outcome = await joinOutcome(channel, WAIT_MS);
    if (outcome !== "joined") return { name, ok: false, detail: `the listener's join was ${outcome}; nothing was proved` };
    // The forged notice first, as any visitor could send it: the public key and nothing else.
    const forged = await fetch(`${minted.url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: minted.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: minted.topic, event: REVISION_EVENT, payload: { projectId, rev: 666, author: null }, private: true }] }),
    });
    await forged.body?.cancel().catch(() => undefined);
    // Then the real one, so a silent listener is told apart from a refused forgery.
    if (!(await publishRevision({ projectId, rev: 42, author: userId }))) {
      return { name, ok: false, detail: "the real publish was not accepted; nothing was proved" };
    }
    const deadline = Date.now() + WAIT_MS;
    while (!heard.includes(42) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    // A moment more, in case the forged notice is merely slower.
    await new Promise((r) => setTimeout(r, 1_000));
    if (!heard.includes(42)) return { name, ok: false, detail: "the real notice never arrived either; nothing was proved" };
    if (heard.includes(666)) return { name, ok: false, detail: "the forged notice arrived: the anon role may publish on a private topic" };
    return { name, ok: true, detail: `the real notice arrived and the forged one did not (REST answered ${forged.status})` };
  } finally {
    await hangUp(client, channel);
  }
}

/** 5. A token can receive and cannot send: a member hears the server and not a fellow member. */
async function tokenCannotSend(projectId: string, userId: string): Promise<CheckResult> {
  const name = "a member's token cannot send on its topic";
  const minted = await mintRealtimeToken(userId, projectId);
  const forger = await mintRealtimeToken("realtime-check-forger", projectId);
  if (!minted || !forger) return { name, ok: false, detail: "the server would not mint a token; check SUPABASE_JWT_PRIVATE_KEY" };
  const listener = await clientFor(minted.token);
  const sender = await clientFor(forger.token);
  const hearing = listener.channel(minted.topic, { config: { private: true } });
  const sending = sender.channel(forger.topic, { config: { private: true } });
  const heard: unknown[] = [];
  hearing.on("broadcast", { event: REVISION_EVENT }, (message) => {
    heard.push((message.payload as { rev?: unknown })?.rev);
  });
  try {
    for (const channel of [hearing, sending]) {
      const outcome = await joinOutcome(channel, WAIT_MS);
      if (outcome !== "joined") return { name, ok: false, detail: `a join was ${outcome}; nothing was proved` };
    }
    await sending.send({ type: "broadcast", event: REVISION_EVENT, payload: { projectId, rev: 777, author: "forger" } });
    // Then the real one, so a silent listener is told apart from a refused send.
    if (!(await publishRevision({ projectId, rev: 43, author: userId }))) {
      return { name, ok: false, detail: "the real publish was not accepted; nothing was proved" };
    }
    const deadline = Date.now() + WAIT_MS;
    while (!heard.includes(43) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1_000));
    if (!heard.includes(43)) return { name, ok: false, detail: "the real notice never arrived; nothing was proved" };
    if (heard.includes(777)) return { name, ok: false, detail: "the member's notice arrived: an insert policy is letting tokens send" };
    return { name, ok: true, detail: "the server's notice arrived and the member's did not" };
  } finally {
    await hangUp(listener, hearing);
    await hangUp(sender, sending);
  }
}

async function main() {
  await loadEnv();
  const missing = missingEnv();
  if (missing.length > 0) {
    console.error(envComplaint(missing));
    process.exit(1);
  }

  // A project id nobody has: the policy reads the claim, not a table, so this
  // tests the same path a real project takes without touching anyone's data.
  const projectId = `realtime-check-${Date.now()}`;
  const userId = "realtime-check";
  console.log(`Checking ${process.env.NEXT_PUBLIC_SUPABASE_URL} on ${topicFor(projectId)}\n`);

  const results: CheckResult[] = [];
  const checks = [memberHearsRevision, otherProjectRefused, expiredRefused, publicKeyCannotPublish, tokenCannotSend];
  for (const check of checks) {
    const result = await check(projectId, userId).catch((error: unknown) => ({
      name: check.name,
      ok: false,
      // Whatever went wrong, the reader gets a sentence rather than a trace.
      detail: error instanceof Error ? error.message : String(error),
    }));
    results.push(result);
  }

  // Printed together rather than as each finishes, because how a refusal
  // should be read depends on whether anything joined at all (`readResults`).
  for (const text of readResults(results)) console.log(text);

  const code = exitCode(results, checks.length);
  console.log(`\n${code === 0 ? `All ${checks.length} checks passed.` : "Something is not set up as docs/REALTIME_SETUP.md describes."}`);
  process.exit(code);
}

await main();
