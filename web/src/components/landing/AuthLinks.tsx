"use client";

/**
 * Sign in and Sign up in the landing page header. They are plain links in the
 * server's HTML, so they are there before any script runs. Once /api/me has
 * answered, someone signed in sees their name instead, and an installation
 * with no accounts shows nothing.
 */

import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { getAccount, type Account } from "@/store/persist";

const LINK = "focus-ring inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition";

export function AuthLinks() {
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    getAccount().then(setAccount).catch(() => {});
  }, []);

  if (account && account.providers.length === 0) return null;

  if (account?.user) {
    return (
      <a href="/account" className={`${LINK} text-text-secondary hover:bg-surface-hover hover:text-text-primary`}>
        {account.user.name}
      </a>
    );
  }

  return (
    <>
      <a href="/signin" className={`${LINK} text-text-secondary hover:bg-surface-hover hover:text-text-primary`}>
        <LogIn size={15} aria-hidden />
        Sign in
      </a>
      <a href="/signup" className={`${LINK} border border-line text-text-primary hover:bg-surface-hover`}>
        Sign up
      </a>
    </>
  );
}
