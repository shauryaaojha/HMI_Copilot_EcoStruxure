"use client";

/**
 * Saying in place that a feature needs an account, before anyone runs into the
 * refusal: the sentence and the two buttons, on the feature itself. Shows
 * nothing to someone signed in, or where this installation has no accounts.
 */

import { useEffect, useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { SIGN_IN_REFUSED, openSignIn } from "@/lib/client/sign-in";
import { getAccount } from "@/store/persist";

/** True once this browser is known to be signed out where signing in is possible. */
export function useSignedOut(): boolean {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    let live = true;
    const check = (fresh: boolean) => {
      getAccount(fresh)
        .then((account) => {
          if (live) setSignedOut(!account.user && account.providers.length > 0);
        })
        .catch(() => {});
    };
    const refused = () => check(true);
    check(false);
    window.addEventListener(SIGN_IN_REFUSED, refused);
    return () => {
      live = false;
      window.removeEventListener(SIGN_IN_REFUSED, refused);
    };
  }, []);
  return signedOut;
}

/** The two ways in. Both open the dialog, so the work on screen stays there. */
export function SignInButtons({ reason }: { reason?: string }) {
  return (
    <>
      <Button size="sm" variant="primary" icon={<LogIn size={13} aria-hidden />} onClick={() => openSignIn({ mode: "in", reason })}>
        Sign in
      </Button>
      <Button size="sm" variant="secondary" icon={<UserPlus size={13} aria-hidden />} onClick={() => openSignIn({ mode: "up", reason })}>
        Sign up
      </Button>
    </>
  );
}

export function SignInNotice({ reason, className }: { reason: string; className?: string }) {
  const signedOut = useSignedOut();
  if (!signedOut) return null;
  return (
    <div
      role="status"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-brand-500/40 bg-brand-500/15 px-3 py-2.5", className)}
    >
      <p className="min-w-40 flex-1 text-xs leading-relaxed text-text-primary">{reason}</p>
      <div className="flex shrink-0 gap-2">
        <SignInButtons reason={reason} />
      </div>
    </div>
  );
}
