"use client";

/**
 * What the tool has learned from finished projects, and the means to forget.
 *
 * Every project opened is scanned into the knowledge base (lib/knowledge),
 * and the conversation's tools read its conventions - "RUN tags are shown on
 * a Lamp's CurrentValue in 12 projects". An engineer is entitled to see that,
 * and to remove a customer's project from it: a scan holds that customer's tag
 * names and alarm text. Read from /api/knowledge; nothing here edits a scan.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Panel } from "@/components/ui";
import { jsonOrNull } from "@/lib/ingest/client";
import type { KnowledgeSummary } from "@/lib/knowledge/store";
import type { Conventions } from "@/lib/knowledge/conventions";

interface Listing {
  store: "filesystem" | "mongo" | "off";
  projects: KnowledgeSummary[];
  conventions: Conventions;
}

const STORE: Record<Listing["store"], string> = {
  filesystem: "kept on this machine (.knowledge/)",
  mongo: "kept in the shared database",
  off: "off on this deployment - nothing is kept",
};

export function KnowledgePanel() {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/knowledge");
      const body = await jsonOrNull<Listing>(response);
      if (!response.ok || !body) throw new Error(body?.error ?? `the knowledge base answered ${response.status}`);
      setData(body);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not read the knowledge base");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function forget(id: string) {
    const response = await fetch(`/api/knowledge?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) setError((await jsonOrNull<{ error?: string }>(response))?.error ?? "could not forget that project");
    await load();
  }

  const roles = data ? Object.entries(data.conventions.byRole).filter(([, r]) => r.length > 0).sort((a, b) => b[1][0].count - a[1][0].count).slice(0, 8) : [];

  return (
    <Panel title="What the tool has learned" bordered>
      <div className="space-y-3 text-xs">
        {error && (
          <p className="flex gap-2 text-status-warn">
            <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {!data && !error && <p className="text-text-muted">Reading the knowledge base…</p>}
        {data && (
          <>
            <p className="text-text-muted">
              Every project you open is scanned for its screens, tags, bindings and alarms - structure and names, never the file. The knowledge base is{" "}
              {STORE[data.store]}.
            </p>
            {data.projects.length === 0 ? (
              <p className="text-text-faint">Nothing scanned yet. Open a finished project to teach the tool how your plants are built.</p>
            ) : (
              <ul className="space-y-1">
                {data.projects.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-md border border-line-subtle px-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-text-primary">{p.fileName}</span>
                      <span className="block text-[11px] text-text-muted">
                        {p.product} · {p.counts.screens + p.counts.contentScreens} screens · {p.counts.variables} tags · {p.counts.bindings} bindings
                        {p.problems > 0 ? ` · ${p.problems} not read` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void forget(p.id)}
                      title="Forget this project: its scan is deleted"
                      aria-label={`Forget ${p.fileName}`}
                      className="focus-ring rounded p-1 text-text-muted transition hover:bg-status-alarm/15 hover:text-status-alarm"
                    >
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {roles.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium text-text-secondary">How tags are bound, across {data.conventions.projects} projects</p>
                <ul className="space-y-0.5 text-[11px] text-text-muted">
                  {roles.map(([word, ranked]) => (
                    <li key={word}>
                      <span className="text-figure text-text-primary">{word}</span> → {ranked[0].target} ({ranked[0].count} in {ranked[0].projects}{" "}
                      {ranked[0].projects === 1 ? "project" : "projects"})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
