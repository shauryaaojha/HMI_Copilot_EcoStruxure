"use client";

/** How to reach these projects from Claude: the address, and the three steps it takes. */

import { useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui";

export function ConnectorSetup() {
  const [address, setAddress] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setAddress(`${window.location.origin}/api/mcp`), []);

  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Panel title="Connect Claude to your projects" bordered>
      <div className="space-y-3 text-sm text-text-secondary">
        <ol className="list-decimal space-y-1 pl-5">
          <li>In Claude, open Settings, then Connectors, and add a custom connector.</li>
          <li>Paste the address below, and sign in here when Claude asks.</li>
          <li>Ask Claude about a project. Changes wait as proposals unless you turn on direct writes for that project.</li>
        </ol>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 font-mono text-xs">{address}</code>
          <Button size="sm" variant="secondary" disabled={!address} onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</Button>
        </div>
      </div>
    </Panel>
  );
}
