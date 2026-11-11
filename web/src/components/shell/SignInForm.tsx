"use client";

/**
 * Signing in, and making the account in the first place: one form for both,
 * because on a fresh deployment the second thing every engineer does is the
 * first thing. There is no third-party button to put beside it (decision A in
 * docs/PLAN_FULL_ARCHITECTURE.md).
 *
 * The refusal is one sentence covering a wrong password, an address with no
 * account, and too many tries. That is not vagueness for its own sake: a form
 * that distinguished them would answer "does this person have an account
 * here?" for anyone who asked. Auth.js reports every credential failure as the
 * same error for the same reason, so there is nothing finer to show even if we
 * wanted to.
 *
 * A successful sign-in reloads rather than re-rendering: the project list, the
 * membership and every panel on the page were fetched as whoever was signed in
 * before, and reloading is the only honest way to make all of them agree.
 */

import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { Button, Field, Input } from "@/components/ui";

const REFUSED = "That email and password do not match an account. Sign-in pauses for a while after repeated attempts.";

interface SignInFormProps {
  next?: string;
  compact?: boolean;
  initialMode?: "in" | "up";
  /** The level of the title this form shows. Without it, no title. */
  heading?: "h1" | "h2";
  /** The sentence under the title: what the account is needed for. */
  lead?: string;
  autoFocus?: boolean;
}

const WAYS = [
  { id: "in", label: "Sign in" },
  { id: "up", label: "Sign up" },
] as const;

export function SignInForm({ next, compact = false, initialMode = "in", heading: Heading, lead, autoFocus = false }: SignInFormProps) {
  const [mode, setMode] = useState<"in" | "up">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** Something that went right and still needs saying: the account exists, now sign in. */
  const [notice, setNotice] = useState<string>();
  const [shown, setShown] = useState(false);

  /**
   * Changing tab on /signin or /signup changes the address with it. Without
   * this the page said "Sign up" under /signin, and a reload - or the link
   * someone copied - put them back on the form they had just left.
   */
  function choose(next: "in" | "up") {
    setMode(next);
    setError(undefined);
    setNotice(undefined);
    const path = window.location.pathname;
    if (path === "/signin" || path === "/signup") {
      window.history.replaceState(null, "", `${next === "in" ? "/signin" : "/signup"}${window.location.search}`);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    // The button stays busy until the next page has replaced this one; going
    // back to "Sign in" while the browser was still leaving invited a second press.
    let leaving = false;
    try {
      if (mode === "up") {
        const made = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        });
        if (!made.ok) {
          // The server's own words: it is the side that decided what may be said.
          const body = (await made.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "Could not create the account");
          return;
        }
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (!result || result.error) {
        if (mode === "up") {
          // The account was made a moment ago; it is the sign-in that failed.
          // Saying "no such account" here sent people to sign up a second time,
          // and into "that address is taken".
          setMode("in");
          setNotice("Your account is ready. Sign in with the password you just chose.");
        } else {
          setError(REFUSED);
        }
        return;
      }
      leaving = true;
      window.location.assign(next || window.location.pathname + window.location.search);
    } catch {
      setError("Sign-in is unavailable. Check the connection and try again.");
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      {Heading && (
        <div key={mode} className="reveal is-in">
          <Heading className="text-xl font-semibold tracking-tight text-text-primary">
            {mode === "in" ? "Sign in to HMI Copilot" : "Create your account"}
          </Heading>
          <p className="mt-1 text-sm text-text-secondary">
            {lead ?? (mode === "in" ? "Welcome back. Your projects are where you left them." : "Use the Copilot and keep your projects on the server.")}
          </p>
        </div>
      )}
      {!Heading && lead && <p className="text-sm text-text-secondary">{lead}</p>}
      <div className="relative grid grid-cols-2 gap-1 rounded-lg border border-line-subtle bg-surface-base p-1">
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc(50%-0.375rem)] rounded-md bg-brand-500 shadow-lg shadow-brand-500/30 transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: mode === "up" ? "translateX(calc(100% + 0.25rem))" : "none" }}
        />
        {WAYS.map((way) => (
          <button
            key={way.id}
            type="button"
            aria-pressed={mode === way.id}
            onClick={() => choose(way.id)}
            className={
              "focus-ring relative rounded-md py-1.5 text-sm font-medium transition-colors duration-300 " +
              (mode === way.id ? "text-text-onbrand" : "text-text-muted hover:text-text-primary")
            }
          >
            {way.label}
          </button>
        ))}
      </div>
      <Field layout="stack" label="Email">
        <Input type="email" autoComplete="email" autoFocus={autoFocus} required value={email} onChange={e => setEmail(e.target.value)} />
      </Field>
      <Field layout="stack" label="Password" hint={mode === "up" ? "At least 10 characters." : undefined}>
        <Input
          type={shown ? "text" : "password"}
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          required
          // The server's own floor, said before the request rather than after it.
          minLength={mode === "up" ? 10 : undefined}
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="pr-9"
          adornment={
            <button
              type="button"
              onClick={() => setShown(s => !s)}
              aria-label={shown ? "Hide the password" : "Show the password"}
              aria-pressed={shown}
              className="focus-ring rounded p-1 text-text-muted transition hover:text-text-primary"
            >
              {shown ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            </button>
          }
        />
      </Field>
      {mode === "up" && (
        <div className="reveal is-in">
          <Field layout="stack" label="Name" hint="What other members of a project see.">
            <Input autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
          </Field>
        </div>
      )}
      {error && (
        <p role="alert" className="animate-rise rounded-lg border border-status-warn/30 bg-status-warn/[0.08] px-2.5 py-2 text-xs leading-snug text-status-warn">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="animate-rise rounded-lg border border-brand-500/30 bg-brand-500/[0.08] px-2.5 py-2 text-xs leading-snug text-text-primary">
          {notice}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        block
        size={compact ? "sm" : "md"}
        disabled={busy}
        className="group gap-2 shadow-lg shadow-brand-500/25 hover:shadow-brand-500/40"
      >
        {busy ? "Working…" : mode === "in" ? "Sign in" : "Create account"}
        {busy
          ? <Loader2 size={15} aria-hidden className="animate-spin" />
          : <ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" />}
      </Button>
      {mode === "in" && <p className="text-center text-xs text-text-muted">Forgot your password? Ask whoever runs this installation.</p>}
    </form>
  );
}
