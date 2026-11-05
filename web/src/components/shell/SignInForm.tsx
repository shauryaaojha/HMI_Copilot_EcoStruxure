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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
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
        setError(REFUSED);
        return;
      }
      window.location.assign(next || window.location.pathname + window.location.search);
    } catch {
      setError("Sign-in is unavailable. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      {Heading && (
        <Heading className="text-base font-semibold text-text-primary">
          {mode === "in" ? "Sign in to HMI Copilot" : "Create your account"}
        </Heading>
      )}
      {lead && <p className="text-sm text-text-secondary">{lead}</p>}
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line-subtle bg-surface-base p-1">
        {WAYS.map((way) => (
          <button
            key={way.id}
            type="button"
            aria-pressed={mode === way.id}
            onClick={() => { setMode(way.id); setError(undefined); }}
            className={
              "focus-ring rounded-md py-1.5 text-sm font-medium transition " +
              (mode === way.id ? "bg-brand-500 text-text-onbrand" : "text-text-muted hover:text-text-primary")
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
          type="password"
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
      </Field>
      {mode === "up" && (
        <Field layout="stack" label="Name" hint="What other members of a project see.">
          <Input autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
        </Field>
      )}
      {error && (
        <p role="alert" className="text-xs text-status-warn">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" block size={compact ? "sm" : "md"} disabled={busy}>
        {busy ? "Working…" : mode === "in" ? "Sign in" : "Create account"}
      </Button>
      {mode === "in" && <p className="text-center text-xs text-text-muted">Forgot your password? Ask whoever runs this installation.</p>}
    </form>
  );
}
