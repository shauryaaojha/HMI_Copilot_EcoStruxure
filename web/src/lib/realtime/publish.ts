/**
 * Telling everyone in a project that a revision landed.
 *
 * This runs after the Mongo transaction has already decided the outcome. The
 * broadcast is a hint, not the truth: it says "there is something newer than
 * you have", and the client goes and fetches it over HTTP. Nothing is resolved
 * from a broadcast, because the revision it names was assigned by the
 * transaction and a client that missed one simply asks for everything since
 * its own (docs/PLAN_FULL_ARCHITECTURE.md §2.3).
 *
 * That is also why a failure here is swallowed. If the broadcast is lost, the
 * project is still correct: the next broadcast, the next poll or the next
 * reconnect closes the gap. Failing the write because the notification failed
 * would turn a cosmetic outage into a data one.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { REVISION_EVENT, serverConfig, topicFor, type RevisionNotice } from "./config";

/**
 * One client for the process, made on first use.
 *
 * Signed with the service-role key, which is why this module must never be
 * imported from anything that runs in a browser. The key authorizes the
 * publish; it is never handed out.
 */
let client: SupabaseClient | null = null;
let clientKey = "";

function serverClient(): SupabaseClient | null {
  const config = serverConfig();
  if (!config) return null;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!serviceKey) return null;
  const key = `${config.url}:${serviceKey.length}`;
  if (!client || clientKey !== key) {
    client = createClient(config.url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clientKey = key;
  }
  return client;
}

/**
 * Announce a committed revision. Resolves to whether it was sent, so a caller
 * that wants to log the miss can; no caller should fail because of it.
 */
export async function publishRevision(notice: RevisionNotice): Promise<boolean> {
  const supabase = serverClient();
  if (!supabase) return false;
  try {
    const channel = supabase.channel(topicFor(notice.projectId), { config: { private: true } });
    await channel.send({ type: "broadcast", event: REVISION_EVENT, payload: notice });
    await supabase.removeChannel(channel);
    return true;
  } catch {
    // See the header: a lost notification is closed by the next one.
    return false;
  }
}

/** Exported for tests, which need each case to start from nothing. */
export function resetRealtimeClient() {
  client = null;
  clientKey = "";
}
