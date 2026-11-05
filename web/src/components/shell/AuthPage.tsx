import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { currentUser, providers } from "@/lib/server/session";
import { SignInForm } from "./SignInForm";
import { SchneiderMark } from "./SchneiderMark";

/**
 * /signin and /signup: one card, starting on the tab the address names. A link
 * from elsewhere comes back to `next` afterwards.
 */
export async function AuthPage({ mode, next }: { mode: "in" | "up"; next: string | undefined }) {
  const target = safeNext(next);
  // Already signed in: the only reason to be here is to get somewhere else.
  if (await currentUser()) redirect(target);
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base p-6">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface-float p-6" style={{ boxShadow: "var(--elev-2)" }}>
        <SchneiderMark className="text-brand-400" />
        {providers().length ? (
          <SignInForm next={target} initialMode={mode} heading="h1" />
        ) : (
          <>
            <h1 className="text-base font-semibold text-text-primary">{mode === "in" ? "Sign in" : "Sign up"}</h1>
            <p className="text-sm text-status-warn">Sign-in is not configured on this installation.</p>
          </>
        )}
        <a href="/" className="focus-ring inline-flex items-center gap-1 rounded-md text-xs text-text-muted hover:text-text-primary">
          <ArrowLeft size={12} aria-hidden /> Back to HMI Copilot
        </a>
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
  // A browser reads "\" as "/" and drops tabs and newlines, so "/\evil" and
  // "/<tab>/evil" are "//evil" by the time it navigates.
  return value && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(value) ? value : "/";
}
