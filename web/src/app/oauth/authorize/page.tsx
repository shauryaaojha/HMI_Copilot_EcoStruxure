import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/session";
import { SchneiderMark } from "@/components/shell/SchneiderMark";
import { Button } from "@/components/ui";
import {
  AuthorizeRefusal, authorizeErrorRedirect, OauthError, scopeLabel, validateAuthorizeRequest,
} from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The consent screen: the one place a human decides that Claude may read and
 * change their projects.
 *
 * Three things it has to get right.
 *
 * It names what is being granted, scope by scope, in the same words account
 * settings will use later - a permission an engineer cannot recognise
 * afterwards is one they cannot sensibly revoke.
 *
 * It shows the redirect URI's hostname, which the spec requires
 * (docs/CONNECTOR_SPEC_NOTES.md §3) and which is the only thing on this page
 * that distinguishes the real claude.ai from a client that registered itself
 * under the same `client_name`. The name is whatever the client typed; the
 * host is where the code will actually be sent.
 *
 * And it refuses rather than redirects when the thing that failed is what
 * would have decided where to redirect. An unknown client, or a redirect URI
 * this client never registered, is shown here; everything else goes back to
 * the client as an `error` on its own URI, because that is where a client can
 * act on it.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && typeof value[0] === "string") params.set(key, value[0]);
  }

  // Signing in comes first, and comes back here with the request intact: the
  // authorization request is in the query string, so /signin?next= carries the
  // whole thing without this page having to park it anywhere.
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/oauth/authorize?${params.toString()}`)}`);

  let approved;
  try {
    approved = await validateAuthorizeRequest(params, await asRequest(params));
  } catch (error) {
    if (error instanceof AuthorizeRefusal) return <Refusal message={error.message} />;
    if (error instanceof OauthError && params.get("redirect_uri")) {
      // Only reached once the redirect URI has been verified against the
      // registration, which is what makes sending an error to it safe.
      redirect(authorizeErrorRedirect(params.get("redirect_uri")!, error, params.get("state") ?? undefined));
    }
    return <Refusal message={error instanceof Error ? error.message : "This authorization request could not be read."} />;
  }

  return (
    <Frame>
      <h1 className="text-base font-semibold text-text-primary">Connect {approved.client.clientName}</h1>
      <p className="text-sm text-text-secondary">
        Signed in as {user.name}
        {user.email ? ` (${user.email})` : ""}.
      </p>
      <div className="space-y-2 rounded-lg border border-line bg-surface-raised p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">This will be allowed to</p>
        <ul className="space-y-1.5 text-sm text-text-secondary">
          {approved.scopes.map(scope => (
            <li key={scope} className="flex gap-2">
              <span aria-hidden className="text-brand-400">&bull;</span>
              <span>{scopeLabel(scope)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-text-secondary">
        After you allow this, your browser will be sent to{" "}
        <strong className="font-semibold text-text-primary">{approved.redirectHost}</strong>. Only continue if you
        recognise that address.
      </p>
      <form action="/api/oauth/authorize" method="post" className="space-y-2">
        {[...params.entries()].map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <Button type="submit" name="decision" value="allow" variant="primary" block>
          Allow
        </Button>
        <Button type="submit" name="decision" value="deny" variant="secondary" block>
          Deny
        </Button>
      </form>
      <p className="text-xs text-text-muted">
        You can disconnect this at any time from <a className="focus-ring underline" href="/account/connections">account connections</a>.
      </p>
    </Frame>
  );
}

/**
 * A page has no `Request` of its own, and `validateAuthorizeRequest` needs one
 * for a single question: which host is this deployment answering on, so that a
 * `resource` parameter naming somebody else's server can be refused. The
 * incoming headers answer it, through the same forwarding rules
 * lib/server/origin.ts applies everywhere else.
 */
async function asRequest(params: URLSearchParams): Promise<Request> {
  const incoming = await headers();
  const forwarded: Record<string, string> = {};
  for (const name of ["host", "x-forwarded-host", "x-forwarded-proto"]) {
    const value = incoming.get(name);
    if (value) forwarded[name] = value;
  }
  return new Request(`https://${forwarded["x-forwarded-host"] ?? forwarded.host ?? "localhost"}/oauth/authorize?${params}`, { headers: forwarded });
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-line bg-surface-float p-6" style={{ boxShadow: "var(--elev-2)" }}>
        <SchneiderMark className="text-brand-400" />
        {children}
      </div>
    </div>
  );
}

function Refusal({ message }: { message: string }) {
  return (
    <Frame>
      <h1 className="text-base font-semibold text-text-primary">This connection cannot be approved</h1>
      <p className="text-sm text-status-warn">{message}</p>
      <p className="text-sm text-text-secondary">
        Nothing has been granted. Remove the connector in Claude and add it again, and if it keeps failing the address
        it was added with is probably not this installation.
      </p>
    </Frame>
  );
}
