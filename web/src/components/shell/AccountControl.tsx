"use client";
/**
 * Account identity and save feedback share the shell on every project page.
 * Conflict choices are explicit: reload takes the remote snapshot, keep yours
 * retries against the revision shown in the conflict. A second concurrent edit
 * produces another conflict rather than a forced overwrite.
 *
 * Signed in, the account is one button that opens a menu. It used to be the
 * name and four text links in a row - Account, Connections, Sign out, Sign out
 * everywhere - which took a third of the top bar and put ending every session
 * one slip away from the link beside it.
 *
 * Signed out, this is two real buttons on every page that has it. They open the
 * dialog (SignInPrompt) so the work on screen stays where it is.
 */
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { Check, CircleAlert, CloudOff, LogOut, Plug, ShieldOff, UserRound } from "lucide-react";
import { SignInButtons } from "./SignInNotice";
import { cn } from "@/components/ui";
import { cloudError, cloudStatus, getAccount, resolveCloudConflict, type Account } from "@/store/persist";
import { useProject } from "@/store/project";

/** "Asha Rao" is AR; an address is its first letter. */
function initials(name: string): string {
  const words = name.trim().split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[1][0] : "")).toUpperCase();
}

/** Whether the project is saved, as a dot and a word rather than a sentence in the bar. */
function SaveState({ projectId }: { projectId: string }) {
  const status = cloudStatus(projectId);
  const failed = status === "Not saved on the server";
  const elsewhere = status === "Changed elsewhere";
  const saved = /^saved/i.test(status);
  return (
    <span
      role="status"
      title={cloudError(projectId) || status}
      className={cn(
        "animate-fade flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
        failed || elsewhere ? "border-status-warn/40 text-status-warn" : "border-line-subtle text-text-muted",
      )}
    >
      {failed || /offline/i.test(status) ? <CloudOff size={11} aria-hidden /> : elsewhere ? <CircleAlert size={11} aria-hidden /> : saved ? <Check size={11} aria-hidden className="text-status-ok" /> : (
        <span aria-hidden className="dot-live h-1.5 w-1.5 rounded-full bg-status-info text-status-info" />
      )}
      {status}
    </span>
  );
}

export function AccountControl({ projectId = "", signIn = true }: { projectId?: string; /** False where the page already offers sign-in beside this. */ signIn?: boolean }) {
  const savedAt = useProject(s => s.savedAt);
  const [account, setAccount] = useState<Account | null>(null);
  const [, update] = useState(0);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void getAccount().then(setAccount).catch(() => setError("Account service unavailable"));
    const changed = () => update(n => n + 1);
    window.addEventListener("hmi-cloud-status", changed);
    return () => window.removeEventListener("hmi-cloud-status", changed);
  }, []);
  // The menu shuts on a click anywhere else, and on Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", key); };
  }, [open]);
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
  // Signing out leaves for the front page: the page behind a session that has
  // ended is a server project that now refuses every request it makes.
  async function endEverySession() {
    try {
      const response = await fetch("/api/account/sessions", { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not end sessions");
      await signOut({ redirectTo: "/" });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not end sessions"); }
  }
  const item = "focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-secondary transition hover:bg-surface-hover hover:text-text-primary";
  return <div className="flex items-center gap-2 text-[11px] text-text-muted">
    {projectId && (account?.user || savedAt) && <SaveState projectId={projectId} />}
    {status === "Not saved on the server" && <span role="alert" className="line-clamp-2 hidden max-w-64 leading-tight text-status-warn lg:block">{cloudError(projectId)}</span>}
    {status === "Changed elsewhere" && <span className="flex items-center gap-1 text-status-warn">
      <button className="focus-ring press rounded-md border border-status-warn/40 px-2 py-0.5 font-medium hover:bg-status-warn/10" onClick={() => void resolve(false)}>Reload</button>
      <button className="focus-ring press rounded-md border border-status-warn/40 px-2 py-0.5 font-medium hover:bg-status-warn/10" onClick={() => void resolve(true)}>Keep yours</button>
    </span>}
    {account?.user ? (
      <div ref={menu} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          title={account.user.name}
          className={cn(
            "focus-ring press flex h-8 items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs transition",
            open ? "border-line-strong bg-surface-hover text-text-primary" : "border-line bg-surface-raised/60 text-text-secondary hover:border-line-strong hover:text-text-primary",
          )}
        >
          <span aria-hidden className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-[10px] font-semibold text-white">{initials(account.user.name)}</span>
          <span className="hidden max-w-28 truncate sm:inline">{account.user.name}</span>
        </button>
        {open && account.providers.length > 0 && (
          <div role="menu" className="menu animate-pop absolute right-0 top-full z-50 mt-2 w-60 origin-top-right p-1.5">
            <p className="truncate px-2 pb-1 pt-1.5 text-xs font-medium text-text-primary">{account.user.name}</p>
            <a role="menuitem" className={item} href="/account"><UserRound size={13} aria-hidden /> Account</a>
            {/* The only way an engineer finds out what the connector has been granted
                is a link from where their name already is. */}
            <a role="menuitem" className={item} href="/account/connections"><Plug size={13} aria-hidden /> Connections</a>
            <span aria-hidden className="my-1 block h-px bg-line-subtle" />
            <button role="menuitem" className={item} onClick={() => void signOut({ redirectTo: "/" })}><LogOut size={13} aria-hidden /> Sign out</button>
            <button role="menuitem" className={cn(item, "hover:text-status-alarm")} onClick={() => void endEverySession()} title="Ends this account's sessions on every device">
              <ShieldOff size={13} aria-hidden /> Sign out everywhere
            </button>
          </div>
        )}
      </div>
    ) : signIn && account?.providers.length ? <SignInButtons /> : null}
    {error && <span role="alert" className="text-status-warn">{error}</span>}
  </div>;
}
