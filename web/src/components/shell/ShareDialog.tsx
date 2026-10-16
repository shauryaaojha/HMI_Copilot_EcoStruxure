"use client";

/**
 * Who can open this project, and the links that let more people in.
 *
 * Three sections, in the order an owner asks the questions: who is already in
 * and as what, which links are out there, and a new link. Everyone with access
 * can see the members; only a role that may manage the project (the owner)
 * changes a role, removes someone, or sees and makes links - the same split
 * the server enforces on /api/projects/[id]/members and /shares.
 *
 * A link's token is shown once. The server keeps only its SHA-256 hash, so it
 * cannot hand the link back later; this browser remembers the tokens it
 * created (localStorage, per project) so Copy keeps working here, and a link
 * made on another device says plainly that it cannot be copied from this one.
 * That is a deliberate trade: a database leak must not leak working links.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Trash2, Users, X } from "lucide-react";
import { useCan, type AccessRole } from "@/store/access";
import { Badge, Button, Field, Input, Select, Toggle, cn } from "@/components/ui";

/** A member as GET /api/projects/[id]/members returns one. */
interface Member {
  userId: string;
  name: string;
  email?: string;
  image?: string;
  role: AccessRole;
  addedAt: number;
}

/** The roles a link or a non-owner member can carry. Ownership is never handed out this way. */
type GrantRole = "viewer" | "commenter" | "editor";

/** A link as the server describes it. `id` is the token's hash, not the token. */
interface ShareInfo {
  id: string;
  role: GrantRole;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  allowExport: boolean;
  revokedAt?: number;
}

const ROLE_OPTIONS: { value: GrantRole; label: string }[] = [
  { value: "viewer", label: "Viewer — can look" },
  { value: "commenter", label: "Commenter — can comment" },
  { value: "editor", label: "Editor — can change" },
];

const ROLE_LABEL: Record<AccessRole, string> = {
  owner: "Owner",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
};

const DAY = 24 * 60 * 60 * 1000;

/** Where this browser keeps the raw tokens of links it created, per project. */
const tokensKey = (projectId: string) => `hmi-copilot:share-tokens:${projectId}`;

/**
 * The tokens this browser created for `projectId`, keyed by share id. Empty
 * when storage is unavailable (private mode, blocked site data) - Copy then
 * reports that it cannot, rather than the dialog failing.
 */
export function readShareTokens(projectId: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(tokensKey(projectId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Remembers one created link's token. A failed write only costs Copy on this device. */
function rememberShareToken(projectId: string, shareId: string, token: string) {
  try {
    const next = { ...readShareTokens(projectId), [shareId]: token };
    window.localStorage.setItem(tokensKey(projectId), JSON.stringify(next));
  } catch {
    // Storage is unavailable: the link still works, it just cannot be copied later.
  }
}

/** The full address a token opens. */
function linkFor(token: string): string {
  return `${window.location.origin}/s/${token}`;
}

/** The server's error text, or a plain fallback. */
async function errorOf(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** "3 Nov", or "3 Nov 2027" when it is not this year. */
function shortDate(at: number): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * The Share dialog, opened from the project header of a server project.
 *
 * Every change is followed by a fresh read of members and links, so what the
 * dialog shows is always what the server holds rather than what this browser
 * hoped it did.
 */
export function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const manage = useCan("manage");
  const [members, setMembers] = useState<Member[]>([]);
  const [shares, setShares] = useState<ShareInfo[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // The new-link form.
  const [role, setRole] = useState<GrantRole>("viewer");
  const [days, setDays] = useState(14);
  const [allowExport, setAllowExport] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; token: string } | null>(null);

  const base = `/api/projects/${encodeURIComponent(projectId)}`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${base}/members`, { cache: "no-store" });
      if (!response.ok) throw new Error(await errorOf(response, "Could not load the members"));
      setMembers(((await response.json()) as { members: Member[] }).members ?? []);
      if (manage) {
        const listed = await fetch(`${base}/shares`, { cache: "no-store" });
        if (!listed.ok) throw new Error(await errorOf(listed, "Could not load the links"));
        setShares(((await listed.json()) as { shares: ShareInfo[] }).shares ?? []);
      }
      setTokens(readShareTokens(projectId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sharing");
    }
  }, [base, manage, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** One request, then a fresh read; any failure lands in the error line. */
  async function run(request: () => Promise<Response>, fallback: string) {
    try {
      const response = await request();
      if (!response.ok) throw new Error(await errorOf(response, fallback));
      await load();
      return response;
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
      return null;
    }
  }

  function changeRole(userId: string, next: GrantRole) {
    void run(
      () =>
        fetch(`${base}/members/${encodeURIComponent(userId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: next }),
        }),
      "Could not change the role",
    );
  }

  function removeMember(userId: string) {
    void run(
      () => fetch(`${base}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
      "Could not remove the member",
    );
  }

  function revoke(shareId: string) {
    void run(
      () => fetch(`${base}/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" }),
      "Could not revoke the link",
    );
  }

  async function createLink() {
    setCreating(true);
    try {
      const response = await fetch(`${base}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, days, allowExport }),
      });
      if (!response.ok) throw new Error(await errorOf(response, "Could not create the link"));
      const body = (await response.json()) as { share: ShareInfo; token: string; url: string };
      rememberShareToken(projectId, body.share.id, body.token);
      setCreated({ id: body.share.id, token: body.token });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the link");
    } finally {
      setCreating(false);
    }
  }

  async function copy(shareId: string, token: string) {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopied(shareId);
      setTimeout(() => setCopied((c) => (c === shareId ? null : c)), 1500);
    } catch {
      setError("The clipboard is unavailable - select the link and copy it by hand.");
    }
  }

  const now = Date.now();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-label="Share this project"
        className="flex w-[34rem] max-w-full flex-col overflow-hidden rounded-xl border border-line bg-surface-float"
        style={{ boxShadow: "var(--elev-3)" }}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
          <Users size={14} aria-hidden className="text-brand-400" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Share</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring rounded-md p-1 text-text-muted transition hover:bg-surface-hover hover:text-text-primary"
          >
            <X size={14} aria-hidden />
          </button>
        </header>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-4 text-xs">
          {error && (
            <p role="alert" className="rounded-md border border-status-warn/30 bg-status-warn/[0.06] p-2 text-status-warn">
              {error}
            </p>
          )}

          {/* --- members ---------------------------------------------------- */}
          <div className="space-y-2">
            <p className="label-eyebrow">People with access</p>
            <ul className="divide-y divide-line-subtle rounded-md border border-line-subtle">
              {members.map((member) => (
                <li key={member.userId} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-text-primary">{member.name}</p>
                    {member.email && <p className="truncate text-[11px] text-text-muted">{member.email}</p>}
                  </div>
                  {manage && member.role !== "owner" ? (
                    <>
                      <div className="w-32">
                        <Select
                          size="sm"
                          value={member.role}
                          aria-label={`Role for ${member.name}`}
                          onChange={(e) => changeRole(member.userId, e.target.value as GrantRole)}
                          options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: ROLE_LABEL[o.value] }))}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label={`Remove ${member.name}`}
                        title={`Remove ${member.name}`}
                        onClick={() => removeMember(member.userId)}
                        className="hover:text-status-alarm"
                        icon={<Trash2 size={13} />}
                      />
                    </>
                  ) : (
                    <Badge tone={member.role === "owner" ? "brand" : "neutral"}>{ROLE_LABEL[member.role]}</Badge>
                  )}
                </li>
              ))}
              {members.length === 0 && <li className="px-3 py-2 text-text-muted">Loading…</li>}
            </ul>
          </div>

          {manage && (
            <>
              {/* --- links ------------------------------------------------- */}
              <div className="space-y-2">
                <p className="label-eyebrow">Links</p>
                {shares.length === 0 ? (
                  <p className="text-text-muted">No links yet.</p>
                ) : (
                  <ul className="divide-y divide-line-subtle rounded-md border border-line-subtle">
                    {shares.map((share) => {
                      const token = tokens[share.id];
                      const expired = share.expiresAt <= now;
                      const dead = !!share.revokedAt || expired;
                      return (
                        <li key={share.id} className={cn("flex items-center gap-2 px-3 py-2", dead && "opacity-60")}>
                          <Link2 size={13} aria-hidden className="shrink-0 text-text-faint" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-text-primary">
                              {ROLE_LABEL[share.role]}
                              {share.allowExport && <span className="ml-1.5 font-normal text-text-muted">· can export</span>}
                            </p>
                            <p className="text-[11px] text-text-muted">
                              {share.revokedAt
                                ? `Revoked ${shortDate(share.revokedAt)}`
                                : expired
                                  ? `Expired ${shortDate(share.expiresAt)}`
                                  : `Expires ${shortDate(share.expiresAt)}`}
                              {!dead && !token && " · Copy unavailable — created on another device"}
                            </p>
                          </div>
                          {share.revokedAt ? (
                            <Badge tone="alarm">Revoked</Badge>
                          ) : expired ? (
                            <Badge tone="warn">Expired</Badge>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!token}
                                onClick={() => token && void copy(share.id, token)}
                                title={token ? "Copy the link" : "Copy unavailable — created on another device"}
                                icon={copied === share.id ? <Check size={13} /> : <Copy size={13} />}
                              >
                                {copied === share.id ? "Copied" : "Copy"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => revoke(share.id)}
                                title="Revoke: the link stops working for everyone who has it"
                                className="hover:text-status-alarm"
                              >
                                Revoke
                              </Button>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* --- new link ---------------------------------------------- */}
              <div className="space-y-3 rounded-md border border-line-subtle p-3">
                <p className="label-eyebrow">New link</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Role" layout="stack">
                    <Select
                      size="sm"
                      value={role}
                      aria-label="Link role"
                      onChange={(e) => {
                        const next = e.target.value as GrantRole;
                        setRole(next);
                        // Export is off for a viewer link unless asked for, on
                        // for the roles that could rebuild the file anyway.
                        setAllowExport(next !== "viewer");
                      }}
                      options={ROLE_OPTIONS}
                    />
                  </Field>
                  <Field label="Expires after (days)" layout="stack">
                    <Input
                      type="number"
                      min={1}
                      max={90}
                      value={days}
                      aria-label="Expires after, in days"
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value));
                        if (Number.isFinite(n)) setDays(Math.max(1, Math.min(90, n)));
                      }}
                      className="h-7 text-xs"
                    />
                  </Field>
                </div>
                <Toggle size="sm" checked={allowExport} onChange={setAllowExport} label="Allow export" />
                <p className="text-[11px] text-text-muted">
                  Anyone with the link can open the project as a {ROLE_LABEL[role].toLowerCase()} until{" "}
                  {shortDate(now + days * DAY)}.{" "}
                  {role === "viewer"
                    ? "A viewer link works without an account."
                    : "They will be asked to sign in, and become a member."}
                </p>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="primary" size="sm" disabled={creating} onClick={() => void createLink()} icon={<Link2 size={13} />}>
                    {creating ? "Creating…" : "Create link"}
                  </Button>
                </div>

                {created && (
                  <div className="space-y-1.5 rounded-md border border-brand-500/30 bg-brand-500/[0.06] p-2">
                    <p className="text-[11px] text-text-secondary">
                      Link created. It is shown in full only now; this browser remembers it for Copy.
                    </p>
                    <div className="flex items-center gap-2">
                      <Input readOnly mono value={linkFor(created.token)} aria-label="New link" onFocus={(e) => e.currentTarget.select()} className="h-7" />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void copy(created.id, created.token)}
                        icon={copied === created.id ? <Check size={13} /> : <Copy size={13} />}
                      >
                        {copied === created.id ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
