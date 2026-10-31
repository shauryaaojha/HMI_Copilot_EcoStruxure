"use client";

/**
 * Account connections: what can reach this account through the MCP connector,
 * and how to stop it.
 *
 * Revocation is the reason this screen exists. An OAuth grant that cannot be
 * withdrawn is a password that cannot be changed, so every row has one button
 * that takes effect on the connector's very next call - the server re-reads
 * the grant on each request rather than trusting a token to expire
 * (lib/server/oauth.ts, `verifyToken`).
 *
 * A new personal token is shown once, in a panel the engineer has to dismiss.
 * Only its hash is stored, so there is no second chance and the copy says so
 * plainly: a page that implied otherwise would be setting up a support request
 * nobody can answer.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Field, Input } from "@/components/ui";

interface Connection {
  id: string;
  clientName: string;
  redirectHost: string;
  permissions: string[];
  createdAt: number;
}

interface PersonalToken {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number;
}

const when = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function Connections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tokens, setTokens] = useState<PersonalToken[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/connections", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not read your connections");
      const body = (await response.json()) as { connections: Connection[]; tokens: PersonalToken[] };
      setConnections(body.connections);
      setTokens(body.tokens);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read your connections");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function revoke(path: string) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(path, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not revoke that");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke that");
    } finally { setBusy(false); }
  }

  async function mint() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/account/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await response.json().catch(() => null)) as { token?: string; error?: string } | null;
      if (!response.ok || !body?.token) throw new Error(body?.error ?? "Could not create a token");
      setMinted(body.token);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a token");
    } finally { setBusy(false); }
  }

  return <div className="space-y-8">
    {error && <p role="alert" className="text-sm text-status-warn">{error}</p>}

    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Connected clients</h2>
        <p className="text-xs text-text-muted">Claude and anything else you have approved through the connector sign-in.</p>
      </div>
      {!loaded ? <p className="text-sm text-text-muted">Loading.</p>
        : connections.length === 0 ? <p className="text-sm text-text-muted">Nothing is connected. Add the connector in Claude and approve it to see it here.</p>
        : <ul className="space-y-2">
            {connections.map(c => <li key={c.id} className="rounded-lg border border-line bg-surface-raised p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-text-primary">{c.clientName}</p>
                  {/* The host, not the client's own name for itself: the name is
                      whatever it registered, and the host is where codes go. */}
                  <p className="text-xs text-text-muted">Sends to {c.redirectHost} &middot; connected {when(c.createdAt)}</p>
                  <ul className="space-y-0.5 text-xs text-text-secondary">
                    {c.permissions.map(p => <li key={p}>{p}</li>)}
                  </ul>
                </div>
                <Button variant="danger" size="sm" disabled={busy} onClick={() => void revoke(`/api/account/connections/${c.id}`)}>
                  Disconnect
                </Button>
              </div>
            </li>)}
          </ul>}
    </section>

    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Personal access tokens</h2>
        <p className="text-xs text-text-muted">
          For the MCP Inspector and Claude Code, which send a fixed header instead of signing in. Paste one into the
          connector&apos;s <code className="font-mono">Authorization: Bearer</code> header setting. Never put one in a URL.
        </p>
      </div>

      {minted && <div className="space-y-2 rounded-lg border border-brand-500 bg-surface-raised p-3">
        <p className="text-xs font-medium text-text-primary">Copy this now. It is not stored and cannot be shown again.</p>
        <Input readOnly mono value={minted} onFocus={e => e.currentTarget.select()} aria-label="New personal access token" />
        <Button variant="secondary" size="sm" onClick={() => setMinted(undefined)}>Done</Button>
      </div>}

      <div className="flex items-end gap-2">
        <Field layout="stack" label="Name" hint="So you can tell two tokens apart" className="flex-1">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Laptop inspector" maxLength={60} />
        </Field>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void mint()}>Create token</Button>
      </div>

      {loaded && tokens.length > 0 && <ul className="space-y-2">
        {tokens.map(t => <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised p-3">
          <div>
            <p className="text-sm font-medium text-text-primary">{t.name}</p>
            <p className="text-xs text-text-muted">Created {when(t.createdAt)} &middot; expires {when(t.expiresAt)}</p>
          </div>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void revoke(`/api/account/tokens/${t.id}`)}>
            Revoke
          </Button>
        </li>)}
      </ul>}
    </section>
  </div>;
}
