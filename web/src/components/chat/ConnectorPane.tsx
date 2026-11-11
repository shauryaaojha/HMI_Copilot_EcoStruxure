"use client";

/**
 * The MCP tab: Claude, working on this project from outside, through the
 * connector.
 *
 * The chat and the agent are asked from this panel. Claude is asked from its
 * own conversation, so what belongs here is not a composer. It is one of two
 * things:
 *
 * - **Not connected yet**: the steps, with the address to paste, and which of
 *   them are already done.
 * - **Connected**: the changes Claude proposed for this project, to review,
 *   accept or discard. They are the same proposals every member sees, kept
 *   apart from the chat's own because they arrive when nobody here asked.
 *
 * "Connected" means the account has granted a Claude client (or holds a
 * personal token); the grant list is the one /account/connections manages.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CloudOff, Copy, ExternalLink, Loader2, Plug } from "lucide-react";
import { useSignedOut, SignInButtons } from "@/components/shell/SignInNotice";
import { useAccess } from "@/store/access";
import { useProject } from "@/store/project";
import { useProposals } from "@/store/proposals";
import { cn } from "@/components/ui";
import { SharedProposals, fromMcp } from "./SharedProposals";
import { McpHistory } from "./McpHistory";
import type { SharedProposal } from "@/store/proposals";

/** Open ones are decided here; decided ones are in the history below. */
const openFromMcp = (p: SharedProposal) => fromMcp(p) && p.status === "open";

const ASKS = [
  "List my HMI projects",
  "Show me the overview screen of this project",
  "Check this project and tell me what would fail in the editor",
  "Add a ring gauge for the discharge flow, like the one on the other project",
];

type Link = { state: "checking" } | { state: "signed-out" } | { state: "none" } | { state: "connected"; names: string[] };

/** Whether this account has a Claude client (or a personal token) that can reach it. */
function useConnection(signedOut: boolean): Link {
  const [link, setLink] = useState<Link>({ state: "checking" });
  useEffect(() => {
    if (signedOut) return setLink({ state: "signed-out" });
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/account/connections", { cache: "no-store" });
        if (!live) return;
        if (response.status === 401) return setLink({ state: "signed-out" });
        if (!response.ok) return setLink({ state: "none" });
        const body = (await response.json()) as { connections?: { clientName: string }[]; tokens?: unknown[] };
        const names = [...new Set((body.connections ?? []).map((c) => c.clientName))];
        if (names.length === 0 && (body.tokens ?? []).length > 0) names.push("a personal token");
        setLink(names.length > 0 ? { state: "connected", names } : { state: "none" });
      } catch {
        if (live) setLink({ state: "none" });
      }
    })();
    return () => {
      live = false;
    };
  }, [signedOut]);
  return link;
}

function Address() {
  const [address, setAddress] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setAddress(`${window.location.origin}/api/mcp`), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard permission: the address is on screen to select by hand.
    }
  }

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-line-subtle bg-surface-raised/60 p-1 pl-2.5">
      <code className="text-ident min-w-0 flex-1 truncate text-text-secondary">{address || "…"}</code>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={!address}
        aria-label="Copy the connector address"
        className="focus-ring press flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
      >
        {copied ? <Check size={11} aria-hidden className="text-connector-400" /> : <Copy size={11} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Not connected: the steps, the first one ticked when it is already done. */
function Steps({ signedIn }: { signedIn: boolean }) {
  const steps = [
    { title: "Sign in here", note: "The connector works on the projects saved to your account.", done: signedIn },
    { title: "Add a custom connector in Claude", note: "Settings, then Connectors, then Add custom connector. Paste this address.", address: true },
    { title: "Approve it", note: "Claude sends you back here to sign in and say yes." },
    { title: "Ask", note: "Each change Claude makes waits here as a proposal for you to accept." },
  ];
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-text-primary">Connect Claude over MCP</p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">Then ask Claude to build or change this project, and its proposals arrive in this tab.</p>
      </div>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-2.5">
            <span
              aria-hidden
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px]",
                step.done ? "border-connector-500/60 bg-connector-500/20 text-connector-400" : "border-line text-text-muted",
              )}
            >
              {step.done ? <Check size={10} strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className={cn("text-xs font-medium", step.done ? "text-text-muted line-through" : "text-text-primary")}>{step.title}</p>
              <p className="text-[11px] leading-relaxed text-text-muted">{step.note}</p>
              {step.address && <Address />}
              {i === 0 && !signedIn && (
                <div className="flex gap-2 pt-0.5">
                  <SignInButtons reason="Sign in so Claude can open this project through the connector." />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <a href="/account/connections" className="focus-ring inline-flex items-center gap-1 rounded text-[11px] text-connector-400 hover:underline">
        Connections on your account <ExternalLink size={10} aria-hidden />
      </a>
    </div>
  );
}

export function ConnectorPane({ projectId }: { projectId: string }) {
  const name = useProject((s) => s.name);
  const cloud = useAccess((s) => s.access !== null && s.projectId === projectId);
  const signedOut = useSignedOut();
  const link = useConnection(signedOut);
  const list = useProposals((s) => s.list);
  const mcp = useMemo(() => list.filter(fromMcp), [list]);
  const waiting = mcp.filter((p) => p.status === "open").length;
  const gaps = mcp.filter((p) => p.status === "open").reduce((n, p) => n + p.rejected.length, 0);
  // Proposals already here mean Claude got in, whatever the grant list says.
  const connected = link.state === "connected" || mcp.length > 0;

  if (link.state === "checking" && mcp.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-text-muted">
        <Loader2 size={13} className="animate-spin" aria-hidden /> Checking the connector…
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
      {!connected ? (
        <Steps signedIn={link.state !== "signed-out"} />
      ) : (
        <>
          <div className="animate-rise flex gap-2.5 rounded-xl border border-connector-500/35 bg-connector-500/[0.08] p-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-connector-500/20 text-connector-400">
              <Plug size={13} aria-hidden />
            </span>
            <div className="min-w-0 space-y-1 text-xs leading-relaxed">
              <p className="font-medium text-text-primary">
                MCP connected{link.state === "connected" ? ` · ${link.names.slice(0, 2).join(", ")}` : ""}
              </p>
              <p className="text-text-muted">
                {waiting > 0
                  ? `Claude proposed ${waiting === 1 ? "a change" : `${waiting} changes`} for this project. Review them below; nothing is applied until you accept.`
                  : "When Claude changes this project, its proposals wait here for you to accept or discard, unless direct writes are on for the project."}
              </p>
            </div>
          </div>

          {!cloud && (
            <div className="flex gap-2.5 rounded-xl border border-line-subtle bg-surface-raised/50 p-3 text-xs leading-relaxed">
              <CloudOff size={13} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
              <p className="text-text-muted">
                <span className="font-medium text-text-primary">{name}</span> is only in this browser, so Claude cannot see it. Upload it from the Projects page
                to work on it from Claude.
              </p>
            </div>
          )}

          {gaps > 0 && (
            <div className="flex gap-2.5 rounded-xl border border-status-warn/30 bg-status-warn/[0.07] p-3 text-xs leading-relaxed">
              <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0 text-status-warn" />
              <p className="text-text-muted">
                <span className="font-medium text-text-primary">
                  {gaps} part{gaps === 1 ? "" : "s"} of what Claude asked for could not be done.
                </span>{" "}
                They are listed on each proposal, and logged so the app can learn to do them.
              </p>
            </div>
          )}

          {mcp.length === 0 && (
            <div>
              <p className="label-eyebrow pb-2">No proposals yet. Ask Claude</p>
              <ul className="space-y-1.5">
                {ASKS.map((ask) => (
                  <li key={ask} className="rounded-xl border border-line-subtle bg-surface-raised/60 px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
                    {ask}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <SharedProposals only={openFromMcp} title="Waiting for you" showSteps={false} />
          <McpHistory proposals={mcp} />
        </>
      )}
    </div>
  );
}
