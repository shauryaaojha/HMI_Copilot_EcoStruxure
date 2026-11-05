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
  try {
    await countAttempt("model-user", user.id, MODEL_CALLS_PER_USER);
  } catch (error) {
    // "Too many attempts" is the sign-in form's sentence. Here it should say what ran out.
    if (error instanceof ServerError && error.status === 429) {
      const seconds = Number(error.detail?.retryAfter) || 60;
      const minutes = Math.ceil(seconds / 60);
      throw new ServerError(
        429,
        error.code,
        `You have reached the Copilot limit of ${MODEL_CALLS_PER_USER} requests in 15 minutes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        error.detail,
      );
    }
    throw error;
  }
  return user;
}
