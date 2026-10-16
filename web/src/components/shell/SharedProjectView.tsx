"use client";

/**
 * A project opened from a viewer link by someone without an account.
 *
 * The link's token is the capability. Opening it here asks the server to set
 * the share cookie (POST /api/shares/open), and from then on this browser may
 * read that one project - its snapshot and its comments - and nothing else.
 * What it gets is the same canvas and inspector a member sees, read-only,
 * with the comment threads open beside the canvas.
 *
 * Two things are deliberately different from the workspace. The project is
 * never written into this browser's project index or device cache: a visitor
 * who glanced at a shared screen has not gained a project, and a link that is
 * later revoked must not leave a copy behind. And access is set to read-only
 * before anything is fetched, because the access store's empty state means
 * "a local project, everything allowed" - the one thing a shared view must
 * never show, even for a frame.
 */

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Eye, LogIn } from "lucide-react";
import { useProject } from "@/store/project";
import { useAccess, type ProjectAccess } from "@/store/access";
import type { PersistedProject } from "@/store/persist";
import { CanvasPane } from "@/components/canvas/CanvasPane";
import { Inspector } from "@/components/inspector/Inspector";
import { Button } from "@/components/ui";
import { SchneiderMark } from "./SchneiderMark";
import { useCollab } from "./useCollab";

/** What a signed-out link visitor may do until the server says otherwise. */
const VIEW_ONLY: ProjectAccess = { role: "viewer", actions: ["read"], via: "share" };

/** Why the shared view could not open, in words the visitor can act on. */
function explain(code: string | undefined, status: number): string {
  if (code === "expired") return "This link has expired. Ask the project's owner to send a new one.";
  if (code === "revoked") return "This link has been revoked. Ask the project's owner to send a new one.";
  if (code === "sign-in") return "This link needs you to sign in.";
  if (status === 404) return "This link does not exist. Ask the project's owner to send a new one.";
  return "The shared project could not be opened. Try again in a moment.";
}

/** The snapshot's fields, in the shape the project store hydrates from. */
function hydrateFrom(saved: PersistedProject) {
  return {
    id: saved.id,
    name: saved.name,
    target: saved.target,
    screens: saved.screens,
    activeScreenId: saved.activeScreenId ?? saved.screens[0]?.UniqueId,
    variables: saved.variables,
    alarms: saved.alarms,
    bindings: saved.bindings,
    objectMeta: saved.objectMeta ?? {},
    screenPlacement: saved.screenPlacement ?? {},
    handles: saved.handles ?? {},
    handleSeq: saved.handleSeq ?? 0,
    source: saved.source,
    sourceId: saved.sourceId,
    layout: saved.layout,
    foreign: saved.foreign ?? {},
    composites: saved.composites ?? {},
    programs: saved.programs ?? {},
    plant: saved.plant,
    standards: saved.standards,
    versions: saved.versions ?? [],
    chat: saved.chat ?? [],
    tagImport: saved.tagImport,
  };
}

type Stage = { kind: "opening" } | { kind: "ready" } | { kind: "failed"; message: string };

/**
 * The read-only workspace at /s/<token> for a signed-out visitor holding a
 * viewer link. Rendered by src/app/s/[token]/page.tsx once the server has
 * checked the link is live.
 */
export function SharedProjectView({ token, projectId }: { token: string; projectId: string }) {
  const [stage, setStage] = useState<Stage>({ kind: "opening" });
  const [providers, setProviders] = useState<string[]>([]);
  const name = useProject((s) => s.name);
  const [rev, setRev] = useState<number>();
  // Live: the visitor sees edits as they land, without sending any.
  useCollab(projectId, rev);

  useEffect(() => {
    let live = true;
    // Read-only first, before a single object is drawn.
    useAccess.getState().set(projectId, VIEW_ONLY);

    void (async () => {
      try {
        const opened = await fetch("/api/shares/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!opened.ok) {
          const body = (await opened.json().catch(() => ({}))) as { code?: string };
          if (live) setStage({ kind: "failed", message: explain(body.code, opened.status) });
          return;
        }

        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { code?: string };
          if (live) setStage({ kind: "failed", message: explain(body.code, response.status) });
          return;
        }
        const body = (await response.json()) as { rev?: number; snapshot: PersistedProject; access?: ProjectAccess };
        if (!live) return;

        // Straight into the store, and only the store: no saveProject, no
        // touchProject, no autosave subscription.
        useProject.getState().reset();
        useProject.getState().hydrate(hydrateFrom(body.snapshot));
        // Whatever the server reports, a link visitor never edits.
        const access = body.access ?? VIEW_ONLY;
        useAccess.getState().set(projectId, {
          ...access,
          actions: access.actions.filter((a) => a !== "edit" && a !== "manage"),
        });
        setRev(body.rev);
        setStage({ kind: "ready" });
      } catch {
        if (live) setStage({ kind: "failed", message: explain(undefined, 0) });
      }
    })();

    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ providers?: string[] }>) : null))
      .then((me) => live && setProviders(me?.providers ?? []))
      .catch(() => {
        // No account service: the view still works, it just offers no sign-in.
      });

    return () => {
      live = false;
      // Leaving the shared view must not leave its role on whatever opens next.
      useAccess.getState().clear();
      useProject.getState().reset();
    };
  }, [token, projectId]);

  return (
    <div className="flex h-screen flex-col bg-surface-base">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle bg-surface-frame px-3">
        <SchneiderMark className="shrink-0 text-brand-400" />
        <Eye size={14} aria-hidden className="shrink-0 text-text-muted" />
        <h1 className="min-w-0 truncate text-sm font-semibold text-text-primary">
          {stage.kind === "ready" ? name : "Shared project"}
          <span className="font-normal text-text-muted"> — shared view, read only</span>
        </h1>
        {providers.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            icon={<LogIn size={13} />}
            onClick={() => void signIn(undefined, { redirectTo: `/s/${token}` })}
          >
            Sign in
          </Button>
        )}
      </header>

      {stage.kind === "ready" ? (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 bg-surface-panel">
            <CanvasPane defaultCommenting />
          </div>
          <div className="w-80 shrink-0 border-l border-line-subtle bg-surface-panel">
            <Inspector />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className={stage.kind === "failed" ? "max-w-md text-center text-sm text-status-warn" : "text-sm text-text-muted"}>
            {stage.kind === "failed" ? stage.message : "Opening the shared project…"}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * A commenter or editor link opened while signed out. Those roles make the
 * visitor a member, so they need an account; signing in comes back to the
 * same link, which then adds the membership and opens the project.
 */
export function ShareSignInPrompt({ token, role, canSignIn }: { token: string; role: string; canSignIn: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base p-6">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface-float p-6" style={{ boxShadow: "var(--elev-2)" }}>
        <SchneiderMark className="text-brand-400" />
        <h1 className="text-base font-semibold text-text-primary">Sign in to open this project</h1>
        <p className="text-sm text-text-secondary">
          This link makes you a {role} of a shared project, so it needs an account. Sign in and you will come straight back here.
        </p>
        {canSignIn ? (
          <Button variant="primary" block icon={<LogIn size={15} />} onClick={() => void signIn(undefined, { redirectTo: `/s/${token}` })}>
            Sign in
          </Button>
        ) : (
          <p className="text-sm text-status-warn">Sign-in is not configured on this installation.</p>
        )}
      </div>
    </div>
  );
}
