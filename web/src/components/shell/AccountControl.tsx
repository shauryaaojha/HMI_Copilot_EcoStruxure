"use client";
/**
 * Account identity and save feedback share the shell on every project page.
 * Conflict choices are explicit: reload takes the remote snapshot, keep yours
 * retries against the revision shown in the conflict. A second concurrent edit
 * produces another conflict rather than a forced overwrite.
 *
 * Signed out, this is two real buttons on every page that has it. They open the
 * dialog (SignInPrompt) so the work on screen stays where it is.
 */
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { SignInButtons } from "./SignInNotice";
import { cloudError, cloudStatus, getAccount, resolveCloudConflict, type Account } from "@/store/persist";
import { useProject } from "@/store/project";
export function AccountControl({ projectId = "" }: { projectId?: string }) {
  const savedAt = useProject(s => s.savedAt);
  const [account, setAccount] = useState<Account | null>(null);
  const [, update] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    void getAccount().then(setAccount).catch(() => setError("Account service unavailable"));
    const changed = () => update(n => n + 1);
    window.addEventListener("hmi-cloud-status", changed);
    return () => window.removeEventListener("hmi-cloud-status", changed);
  }, []);
  const status = cloudStatus(projectId);
  async function resolve(keep: boolean) {
    try {
      const snapshot = await resolveCloudConflict(projectId, keep);
      if (snapshot) {
        useProject.getState().reset();
        useProject.getState().hydrate({ ...snapshot, activeScreenId: snapshot.screens[0]?.UniqueId });
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not resolve conflict"); }
  }
  async function endEverySession() {
    try {
      const response = await fetch("/api/account/sessions", { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not end sessions");
      await signOut();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not end sessions"); }
  }
  return <div className="flex items-center gap-2 text-[11px] text-text-muted">
    {projectId && (account?.user || savedAt) && <span role="status" title={cloudError(projectId)}>{status}</span>}
    {status === "Changed elsewhere" && <span className="flex items-center gap-2 text-status-warn">
      <span>Changed elsewhere - reload or keep yours</span>
      <button className="focus-ring underline" onClick={() => void resolve(false)}>Reload</button>
      <button className="focus-ring underline" onClick={() => void resolve(true)}>Keep yours</button>
    </span>}
    {account?.user ? <>
      <span>{account.user.name}</span>
      {account.providers.length > 0 && <a className="focus-ring rounded-md px-2 py-1 hover:bg-surface-hover" href="/account">Account</a>}
      {/* The only way an engineer finds out what the connector has been granted
          is a link from where their name already is. */}
      {account.providers.length > 0 && <a className="focus-ring rounded-md px-2 py-1 hover:bg-surface-hover" href="/account/connections">Connections</a>}
      {account.providers.length > 0 && <button className="focus-ring rounded-md px-2 py-1 hover:bg-surface-hover" onClick={() => void signOut()}>Sign out</button>}
      {account.providers.length > 0 && <button className="focus-ring rounded-md px-2 py-1 hover:bg-surface-hover" onClick={() => void endEverySession()}>Sign out everywhere</button>}
    </> : account?.providers.length ? <SignInButtons /> : null}
    {error && <span role="alert">{error}</span>}
  </div>;
}
