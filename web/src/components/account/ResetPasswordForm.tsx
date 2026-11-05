"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(undefined);
    try {
      const response = await fetch("/api/account/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newPassword: password }) });
      if (!response.ok) { setMessage((await response.json().catch(() => null))?.error ?? "Could not reset password"); return; }
      window.location.assign("/signin");
    } catch { setMessage("Could not reset password. Check the connection and try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3">
    <Field layout="stack" label="New password" hint="At least 10 characters."><Input type="password" autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)} /></Field>
    {message && <p role="alert" className="text-xs text-status-warn">{message}</p>}
    <Button type="submit" variant="primary" block disabled={busy}>{busy ? "Working…" : "Set new password"}</Button>
  </form>;
}
