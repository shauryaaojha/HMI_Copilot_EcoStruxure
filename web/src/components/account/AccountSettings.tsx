"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { Button, Field, Input } from "@/components/ui";

async function accountRequest(path: string, method: "POST" | "DELETE", body?: object) {
  const response = await fetch(path, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? "Could not update account");
  return result as { retainedSources?: string[] } | null;
}

export function AccountSettings({ name, email }: { name: string; email: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function change(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(undefined);
    try {
      await accountRequest("/api/account/password", "POST", { currentPassword, newPassword });
      await signOut({ callbackUrl: "/signin?next=%2Faccount" });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not change password"); }
    finally { setBusy(false); }
  }
  async function everywhere() {
    setBusy(true); setMessage(undefined);
    try {
      await accountRequest("/api/account/sessions", "DELETE");
      await signOut({ callbackUrl: "/signin" });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not end sessions"); }
    finally { setBusy(false); }
  }
  async function remove(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== "DELETE") return;
    setBusy(true); setMessage(undefined);
    try {
      const result = await accountRequest("/api/account", "DELETE", { password: deletePassword });
      if (result?.retainedSources?.length) {
        await signOut({ redirect: false });
        setMessage(`Account deleted. These files remain in other projects: ${result.retainedSources.join(", ")}`);
        return;
      }
      await signOut({ callbackUrl: "/signin" });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete account"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6 text-sm text-text-secondary">
    <section className="space-y-2 rounded-xl border border-line bg-surface-float p-5">
      <h2 className="font-semibold text-text-primary">Profile</h2>
      <p>Name: {name}</p><p>Email: {email}</p>
      <a className="focus-ring text-brand-400 underline" href="/account/connections">Connections</a>
    </section>
    <form onSubmit={change} className="space-y-3 rounded-xl border border-line bg-surface-float p-5">
      <h2 className="font-semibold text-text-primary">Change password</h2>
      <Field layout="stack" label="Current password"><Input type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></Field>
      <Field layout="stack" label="New password" hint="At least 10 characters."><Input type="password" autoComplete="new-password" required value={newPassword} onChange={event => setNewPassword(event.target.value)} /></Field>
      <Button type="submit" variant="primary" disabled={busy}>Change password</Button>
    </form>
    <section className="space-y-3 rounded-xl border border-line bg-surface-float p-5">
      <h2 className="font-semibold text-text-primary">Sessions</h2>
      <p>End your sessions on every device, including this one.</p>
      <Button type="button" disabled={busy} onClick={() => void everywhere()}>Sign out everywhere</Button>
    </section>
    <form onSubmit={remove} className="space-y-3 rounded-xl border border-line bg-surface-float p-5">
      <h2 className="font-semibold text-status-warn">Delete account</h2>
      <p>Projects with other members must have those members removed or ownership transferred first.</p>
      <Field layout="stack" label="Password"><Input type="password" autoComplete="current-password" required value={deletePassword} onChange={event => setDeletePassword(event.target.value)} /></Field>
      <Field layout="stack" label="Type DELETE to confirm"><Input required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></Field>
      <Button type="submit" disabled={busy || confirmation !== "DELETE"}>Delete account</Button>
    </form>
    {message && <p role="alert" className="text-status-warn">{message}</p>}
  </div>;
}
