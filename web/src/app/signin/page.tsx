import { redirect } from "next/navigation";
import { currentUser, providers } from "@/lib/server/session";
import { SignInForm } from "@/components/shell/SignInForm";
import { SchneiderMark } from "@/components/shell/SchneiderMark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A page to sign in on, for the one flow that needs to come back somewhere
 * afterwards: a share link that makes the visitor a member (web/src/app/s).
 * Everywhere else, signing in happens in the account control without leaving
 * the work on screen.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  // Already signed in: the only reason to be here is to get somewhere else.
  if (await currentUser()) redirect(target);
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base p-6">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface-float p-6" style={{ boxShadow: "var(--elev-2)" }}>
        <SchneiderMark className="text-brand-400" />
        <h1 className="text-base font-semibold text-text-primary">Sign in</h1>
        {providers().length ? (
          <SignInForm next={target} />
        ) : (
          <p className="text-sm text-status-warn">Sign-in is not configured on this installation.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Where to go afterwards, from a query parameter, which means from anyone who
 * can write a link. Only a path on this site is allowed - no scheme, no host,
 * and not `//elsewhere`, which a browser reads as a host - so a crafted link
 * cannot turn our sign-in page into a step on the way to someone else's.
 */
function safeNext(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
