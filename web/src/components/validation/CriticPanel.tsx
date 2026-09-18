"use client";

/**
 * Review a screen with the critic. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.5.
 *
 * The screen is rendered to pixels on the server, shown to the model with
 * the pack's checklist, and the findings come back here beside the render
 * it judged. Clicking a finding selects the object on the canvas; nothing
 * here changes the project. With no model configured the render still
 * shows, so the engineer sees what the critic would have seen.
 */

import { useState } from "react";
import { Eye, Sparkles } from "lucide-react";
import Link from "next/link";
import type { CriticReport } from "@/lib/critic/critic";
import { useProject } from "@/store/project";
import { Badge, Button, Select, cn } from "@/components/ui";

interface Answer {
  provider: "claude" | "gemini" | null;
  model?: string;
  reason?: string;
  report: CriticReport | null;
}

export function CriticPanel({ projectId }: { projectId?: string }) {
  const screens = useProject((s) => s.screens);
  const activeScreenId = useProject((s) => s.activeScreenId);
  const select = useProject((s) => s.select);
  const setActiveScreen = useProject((s) => s.setActiveScreen);
  const [screenId, setScreenId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [png, setPng] = useState<string>();
  const [answer, setAnswer] = useState<Answer>();

  const chosen = screens.find((s) => s.UniqueId === (screenId || activeScreenId)) ?? screens[0];
  const parts = chosen?.Children[0].Children ?? [];

  async function review() {
    if (!chosen) return;
    setRunning(true);
    setError(undefined);
    setAnswer(undefined);
    try {
      const [image, verdict] = await Promise.all([
        fetch("/api/critique", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screen: chosen, renderOnly: true }) }),
        fetch("/api/critique", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screen: chosen }) }),
      ]);
      if (image.ok) {
        const blob = await image.blob();
        setPng((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
      }
      const body = (await verdict.json()) as Answer & { error?: string };
      if (!verdict.ok || body.error) throw new Error(body.error ?? `the critic answered ${verdict.status}`);
      setAnswer(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not review the screen");
    } finally {
      setRunning(false);
    }
  }

  function go(objectName?: string) {
    if (!chosen) return;
    setActiveScreen(chosen.UniqueId);
    const part = objectName ? parts.find((p) => p.Name === objectName) : undefined;
    if (part) select([part.UniqueId]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Select
            size="sm"
            aria-label="Screen to review"
            value={chosen?.UniqueId ?? ""}
            options={screens.map((s) => ({ value: s.UniqueId, label: s.Name }))}
            onChange={(e) => setScreenId(e.target.value)}
          />
        </div>
        <Button variant="primary" size="sm" disabled={running || !chosen} onClick={() => void review()} icon={<Sparkles size={14} />}>
          {running ? "Reviewing…" : "Review this screen"}
        </Button>
        <p className="text-xs text-text-muted">
          Renders the screen and asks the model what an HMI engineer would change. Findings are proposals; nothing changes until you do it.
        </p>
      </div>

      {error && <p className="rounded-md border border-status-alarm/40 bg-status-alarm/10 p-3 text-sm text-status-alarm">{error}</p>}

      {(png || answer) && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {png && (
            <figure className="min-w-0 rounded-panel border border-line-subtle bg-surface-raised p-2">
              {/* The render the critic saw, exactly. */}
              <img src={png} alt={`Render of ${chosen?.Name}`} className="w-full rounded" />
              <figcaption className="flex items-center gap-1.5 pt-1.5 text-[11px] text-text-faint">
                <Eye size={11} aria-hidden /> What the critic saw: {chosen?.Name}, design state.
              </figcaption>
            </figure>
          )}

          <div className="min-w-0 space-y-3">
            {answer && !answer.report && (
              <p className="rounded-md border border-status-warn/30 bg-status-warn/[0.06] p-3 text-xs text-status-warn">
                No review: {answer.reason ?? "no model is configured"}.
              </p>
            )}
            {answer?.report && (
              <>
                <div className="flex items-center gap-2">
                  <Badge tone={answer.report.score >= 4 ? "ok" : answer.report.score >= 3 ? "warn" : "alarm"}>
                    {answer.report.score} / 5
                  </Badge>
                  <span className="font-mono text-[11px] text-text-faint">{answer.model}</span>
                </div>
                <p className="text-sm text-text-secondary">{answer.report.summary}</p>
                {answer.report.findings.length === 0 ? (
                  <p className="text-xs text-text-muted">Nothing an engineer would change.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {answer.report.findings.map((f, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => go(f.object)}
                          className={cn(
                            "focus-ring w-full rounded-lg border p-2.5 text-left transition hover:bg-surface-hover",
                            f.severity === "warning" ? "border-status-warn/30" : "border-line-subtle",
                          )}
                        >
                          <span className="flex items-center gap-2 text-[11px]">
                            <Badge tone={f.severity === "warning" ? "warn" : "info"}>{f.rule}</Badge>
                            {f.object && <span className="font-mono text-text-muted">{f.object}</span>}
                          </span>
                          <span className="mt-1 block text-xs text-text-primary">{f.message}</span>
                          <span className="mt-0.5 block text-[11px] text-text-muted">{f.suggestion}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {projectId && (
                  <Link href={`/project/${projectId}`} className="inline-block text-xs text-brand-400 hover:underline">
                    Open the workspace to act on these →
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
