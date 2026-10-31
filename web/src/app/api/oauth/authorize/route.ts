/**
 * What the consent screen's Allow and Deny buttons post to.
 *
 * Nothing on the form is trusted. The hidden fields are only a way of
 * carrying the original query string across the POST, so the whole request is
 * validated again from scratch here: a form that had been edited to name a
 * different `redirect_uri` would otherwise turn an approval the engineer gave
 * for one client into a code sent to another.
 *
 * The decision needs a signed-in human, so unlike every other route under
 * /api/oauth this one reads the session cookie - which is why it is the one
 * that checks its Origin.
 */
import { currentUser } from "@/lib/server/session";
import { publicOrigin } from "@/lib/server/origin";
import { clientIp, countAttempt } from "@/lib/server/rate-limit";
import {
  approveAuthorization, authorizeErrorRedirect, AuthorizeRefusal, CONNECTOR_ATTEMPTS_PER_IP,
  oauthFailure, OauthError, parseTokenBody, validateAuthorizeRequest,
} from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stricter than `sameOrigin` in lib/server/http.ts, which lets a missing
 * Origin through. Every browser that matters sends one on a POST, and this is
 * the one request where the benefit of the doubt would hand somebody else's
 * site a way to approve a connector against the engineer's own session.
 */
function ownOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin === publicOrigin(request)) return;
  throw new OauthError("invalid_request", "This decision must be made on the HMI Copilot consent page", 403);
}

export async function POST(request: Request): Promise<Response> {
  try {
    ownOrigin(request);
    await countAttempt("connector", clientIp(request), CONNECTOR_ATTEMPTS_PER_IP);
    const form = await parseTokenBody(request);
    const user = await currentUser();
    // The session went away between loading the page and pressing the button.
    // Sending them back through sign-in to the same request is the only answer
    // that does not silently lose the authorization.
    if (!user) {
      const next = `/oauth/authorize?${form.toString()}`;
      return Response.redirect(`${publicOrigin(request)}/signin?next=${encodeURIComponent(next)}`, 303);
    }
    let approved;
    try {
      approved = await validateAuthorizeRequest(form, request);
    } catch (error) {
      // `validateAuthorizeRequest` checks the client and its redirect URI
      // first and raises `AuthorizeRefusal` when either fails, so reaching an
      // `OauthError` means the URI has already been verified against the
      // registration - which is what makes sending an error there safe, and
      // is what a client needs in order to report anything useful. A refusal
      // has nowhere safe to go and comes back here instead.
      if (error instanceof OauthError) {
        return Response.redirect(authorizeErrorRedirect(form.get("redirect_uri")!, error, form.get("state") ?? undefined), 303);
      }
      throw error;
    }
    if (form.get("decision") !== "allow") {
      return Response.redirect(authorizeErrorRedirect(approved.redirectUri, "access_denied", approved.state), 303);
    }
    const { redirect } = await approveAuthorization(approved, user);
    return Response.redirect(redirect, 303);
  } catch (error) {
    if (error instanceof AuthorizeRefusal) return oauthFailure(new OauthError("invalid_request", error.message));
    return oauthFailure(error);
  }
}
