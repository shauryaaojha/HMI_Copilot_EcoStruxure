"use client";

/**
 * Claude, working on this project from outside (the MCP connector).
 *
 * The chat and the agent are asked from this pane. The connector is asked
 * from Claude's own conversation, so what belongs here is not a composer: it
 * is whether Claude can reach this project at all, the address it connects
 * to, and the changes it has left waiting for a decision. Those arrive
 * through the same proposal list and change log as everyone else's, which is
 * why all three can work on one project at once.
 */

import { useEffect, useState } from "react";
import { Check, CloudOff, Copy, ExternalLink, Plug } from "lucide-react";
import { useSignedOut, SignInButtons } from "@/components/shell/SignInNotice";
import { useAccess } from "@/store/access";
import { useProject } from "@/store/project";
import { useProposals } from "@/store/proposals";
import { cn } from "@/components/ui";
import { SharedProposals } from "./SharedProposals";

const ASKS = [
  "List my HMI projects",
  "Show me the overview screen of this project",
  "Check this project and tell me what would fail in the editor",
  "Add a ring gauge for the discharge flow, like the one on the other project",
];

export function ConnectorPane({ projectId }: { projectId: string }) {
  const name = useProject((s) => s.name);
  const cloud = useAccess((s) => s.access !== null && s.projectId === projectId);
  const signedOut = useSignedOut();
  const waiting = useProposals((s) => s.list.filter((p) => p.status === "open").length);
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
    <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
      {/* Whether Claude can see this project at all, said first. */}
      <div
        className={cn(
          "animate-rise flex gap-2.5 rounded-xl border p-3",
          cloud ? "border-connector-500/35 bg-connector-500/[0.08]" : "border-line-subtle bg-surface-raised/50",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
            cloud ? "bg-connector-500/20 text-connector-400" : "bg-surface-hover text-text-muted",
          )}
        >
          {cloud ? <Plug size={13} aria-hidden /> : <CloudOff size={13} aria-hidden />}
        </span>
        <div className="min-w-0 space-y-1 text-xs leading-relaxed">
          {cloud ? (
            <>
              <p className="font-medium text-text-primary">Claude can open this project by name</p>
              <p className="text-text-muted">
                It is listed as <span className="text-ident text-text-secondary">{name}</span> in the connector, beside your other
                projects. What Claude changes waits here as a proposal unless direct writes are on for this project.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-text-primary">This project is only in this browser</p>
              <p className="text-text-muted">
                Claude sees the projects saved on the server. {signedOut ? "Sign in, and this one is saved there." : "Upload it from the Projects page to work on it from Claude."}
              </p>
              {signedOut && (
                <div className="flex gap-2 pt-1">
                  <SignInButtons reason="Sign in to save this project on the server, where Claude can open it." />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="label-eyebrow">Connector address</p>
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
        <p className="text-[11px] leading-relaxed text-text-faint">
          In Claude: Settings, Connectors, add a custom connector, paste this.{" "}
          <a href="/account/connections" className="focus-ring inline-flex items-center gap-0.5 rounded text-connector-400 hover:underline">
            What it has been granted <ExternalLink size={10} aria-hidden />
          </a>
        </p>
      </div>

      {waiting === 0 && (
        <div>
          <p className="label-eyebrow pb-2">Ask Claude</p>
          <ul className="space-y-1.5">
            {ASKS.map((ask) => (
              <li key={ask} className="rounded-xl border border-line-subtle bg-surface-raised/60 px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
                {ask}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What it left for a person to decide. The same cards every member sees. */}
      <SharedProposals />
    </div>
  );
}
