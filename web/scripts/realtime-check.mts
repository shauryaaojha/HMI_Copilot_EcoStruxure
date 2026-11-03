/**
 * The Realtime acceptance check, run once against a real Supabase project.
 *
 *   npm run realtime:check
 *
 * This is the phase 2 checkpoint in docs/REALTIME_SETUP.md, the part the test
 * suite cannot reach: the suite runs on a machine with no Supabase project, so
 * it can prove what the server signs and what the client does with it, but
 * never that Supabase agrees. Three things are proved here, one line each:
 *
 *   1. a member's minted token joins the project channel and receives a
 *      revision broadcast - the policy lets the right token in;
 *   2. a token minted for a different project is refused on this topic - the
 *      policy, not the mint route, is what refuses it (the route would have
 *      refused long before, which is why the token here is minted by hand);
 *   3. an expired token is refused - access ends by itself.
 *
 * It needs no project in MongoDB: a token's topic claim is signed by us and
 * checked by the policy, so a made-up project id exercises exactly the same
 * path a real one does.
 *
 * Exits 0 only when all three pass, so it can be the last step of a setup
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
import { REVISION_EVENT, topicFor } from "../src/lib/realtime/config.js";
import { mintRealtimeToken } from "../src/lib/realtime/token.js";
import { publishRevision, resetRealtimeClient } from "../src/lib/realtime/publish.js";

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
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
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
  if (!minted) return { name, ok: false, detail: "the server would not mint a token; check SUPABASE_JWT_SECRET" };
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
    if (!sent) return { name, ok: false, detail: "the service-role publish failed; check SUPABASE_SERVICE_ROLE_KEY" };
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
  if (!other) return { name, ok: false, detail: "the server would not mint a token; check SUPABASE_JWT_SECRET" };
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
  const token = await expiredToken(process.env.SUPABASE_JWT_SECRET!, userId, projectId);
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
  for (const check of [memberHearsRevision, otherProjectRefused, expiredRefused]) {
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

  resetRealtimeClient();
  const code = exitCode(results);
  console.log(`\n${code === 0 ? "All three checks passed." : "Something is not set up as docs/REALTIME_SETUP.md describes."}`);
  process.exit(code);
}

await main();
