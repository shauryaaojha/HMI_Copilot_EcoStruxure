"use client";

/**
 * The sign-in dialog, on every page. It opens when something asks for it
 * (openSignIn) and when the server refuses someone for not being signed in
 * (lib/client/sign-in.ts decides which refusals). Signing in here reloads the
 * page they are on, so they stay where they were.
 *
 * It is mounted ahead of the page in the root layout: effects run in order, so
 * the watcher is in place before any page's first call.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import { SIGN_IN_REFUSED, onSignInAsked, watchFetch, type SignInAsk } from "@/lib/client/sign-in";
import { SignInForm } from "./SignInForm";

let watching = false;

export function SignInPrompt() {
  const [ask, setAsk] = useState<SignInAsk | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const before = useRef<Element | null>(null);

  useEffect(() => {
    const stop = onSignInAsked((next) => setAsk((open) => open ?? next));
    if (!watching) {
      watching = true;
      window.fetch = watchFetch(
        window.fetch.bind(window),
        (next) => {
          window.dispatchEvent(new Event(SIGN_IN_REFUSED));
          setAsk((open) => open ?? next);
        },
        window.location.origin,
      );
    }
    return stop;
  }, []);

  const open = ask !== null;
  useEffect(() => {
    if (!open) return;
    before.current = document.activeElement;
    return () => {
      if (before.current instanceof HTMLElement) before.current.focus();
    };
  }, [open]);

  // The page behind a dialog does not scroll under it.
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open]);

  if (!ask) return null;

  function keys(event: KeyboardEvent) {
    if (event.key === "Escape") {
      setAsk(null);
      return;
    }
    if (event.key !== "Tab") return;
    const stops = dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input");
    if (!stops?.length) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="animate-fade fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setAsk(null);
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
        onKeyDown={keys}
        className="glass beam-border animate-pop w-full max-w-sm rounded-2xl p-6 text-left"
        style={{ boxShadow: "var(--elev-3)" }}
      >
        <div aria-hidden className="copilot-aurora vivid pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" />
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Close"
          className="absolute right-3 top-3 z-10"
          icon={<X size={14} aria-hidden />}
          onClick={() => setAsk(null)}
        />
        <div className="relative">
          <SignInForm heading="h2" initialMode={ask.mode ?? "in"} lead={ask.reason} autoFocus />
        </div>
      </div>
    </div>
  );
}
