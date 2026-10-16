import { redirect } from "next/navigation";
import { inspectShare, joinShare } from "@/lib/server/shares";
import { currentUser, providers } from "@/lib/server/session";
import { SharedProjectView, ShareSignInPrompt } from "@/components/shell/SharedProjectView";
import { SchneiderMark } from "@/components/shell/SchneiderMark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opening a share link.
 *
 * Outside the workspace group on purpose: a link visitor may have no account
 * and no project of their own, and the workspace shell assumes both. The link
 * is checked here, on the server, before anything is drawn, and there are four
 * outcomes:
 *
 *   - expired, revoked or unknown: a page saying so, and who can fix it;
 *   - signed in: the visitor becomes a member with the link's role (never a
 *     lesser one than they already had) and lands in the project itself;
 *   - signed out with a viewer link: the read-only shared view, right here,
 *     without an account - the token is the capability;
 *   - signed out with a commenter or editor link: a request to sign in, which
 *     comes back to this same address.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await inspectShare(token);
  if (found.status !== "ok") return <LinkProblem status={found.status} />;

  const user = await currentUser();
  if (user) {
    const joined = await joinShare(token, user);
    // Outside any try: redirect() works by throwing.
    redirect(`/project/${joined.projectId}`);
  }

  if (found.share.role !== "viewer") {
    return <ShareSignInPrompt token={token} role={found.share.role} canSignIn={providers().length > 0} />;
  }
  return <SharedProjectView token={token} projectId={found.share.projectId} />;
}

/** A link that no longer opens anything, said plainly. */
function LinkProblem({ status }: { status: "expired" | "revoked" | "missing" }) {
  const title =
    status === "expired"
      ? "This link has expired"
      : status === "revoked"
        ? "This link has been revoked"
        : "This link does not exist";
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base p-6">
      <div
        className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface-float p-6"
        style={{ boxShadow: "var(--elev-2)" }}
      >
        <SchneiderMark className="text-brand-400" />
        <h1 className="text-base font-semibold text-text-primary">{title}</h1>
        <p className="text-sm text-text-secondary">
          Share links stop working when they expire or when the project&apos;s owner revokes them. The owner can
          send you a new link.
        </p>
      </div>
    </div>
  );
}
