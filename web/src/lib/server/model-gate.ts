/**
 * Who may spend the model.
 *
 * Every route that calls a model (or renders for one) spends the deployment's
 * single provider key, so a caller must be signed in, and each user gets a
 * window of calls. Without this, anyone on the internet could empty the shared
 * quota, and then chat, generate, the agent and the connector stop for
 * everyone (docs/audit/BUGS.md S2-02). On a laptop without sign-in, the local
 * engineer identity counts as signed in, as for every other route.
 */
import { ServerError } from "./errors";
import { countAttempt } from "./rate-limit";
import { currentUser } from "./session";
import type { User } from "./repo";

/** Model calls per user per 15-minute window: a busy engineer's chat, with room. */
export const MODEL_CALLS_PER_USER = 120;

export async function modelCaller(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new ServerError(401, "unauthorized", "Sign in to use the Copilot");
  await countAttempt("model-user", user.id, MODEL_CALLS_PER_USER);
  return user;
}
