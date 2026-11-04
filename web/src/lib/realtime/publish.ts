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

import { publicConfig, REVISION_EVENT, secretApiKey, topicFor, type RevisionNotice } from "./config";

/** How long a publish may take before it is given up as lost. */
const PUBLISH_TIMEOUT_MS = 5_000;

/**
 * Announce a committed revision. Resolves to whether Realtime accepted it, so
 * a caller that wants to log the miss can; no caller should fail because of it.
 *
 * Realtime's REST broadcast endpoint, called directly rather than through a
 * supabase-js channel. A channel that has not joined falls back to REST by
 * itself, but answers a failure with the string "error" instead of rejecting
 * (so a lost notice used to read as sent), and it sends the API key as a
 * Bearer token too, which a secret key (`sb_secret_...`) is not meant to be.
 * Here the key goes in `apikey` alone - the gateway turns it into the
 * service role, which RLS does not apply to - and only a 202 counts.
 *
 * The secret key authorizes the publish and is never handed out, which is why
 * this module must never be imported from anything that runs in a browser.
 */
export async function publishRevision(notice: RevisionNotice): Promise<boolean> {
  return publishProjectEvent(notice.projectId, REVISION_EVENT, notice);
}

/** Broadcast one event on a project's channel; the same rules as a revision. */
export async function publishProjectEvent(projectId: string, event: string, payload: object): Promise<boolean> {
  const config = publicConfig();
  const key = secretApiKey();
  if (!config || !key) return false;
  try {
    const response = await fetch(`${config.url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ topic: topicFor(projectId), event, payload, private: true }],
      }),
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status === 202;
  } catch {
    // See the header: a lost notification is closed by the next one.
    return false;
  }
}
