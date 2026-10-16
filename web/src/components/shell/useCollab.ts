"use client";

/**
 * Start a live session for a shared project once it has loaded.
 *
 * Only a server project gets one: the access store says so, because a role
 * only exists for a project on the server (a browser-only or laptop project
 * stays exactly as it was). Viewers and signed-out link visitors listen
 * without sending; editors send their changes too.
 */
import { useEffect } from "react";
import { CollabSession } from "@/lib/collab/sync";
import { browserTransport } from "@/lib/collab/browser";
import { useAccess } from "@/store/access";
import { usePresence } from "@/store/presence";
import { useProject } from "@/store/project";
import { cloudRev, getAccount, liveSaved, setLiveProject } from "@/store/persist";
import { loadProposals, useProposals } from "@/store/proposals";

/** The running session, for the canvas to report the pointer and for tests. */
let current: CollabSession | null = null;

/** The live session for the open project, if there is one. */
export function liveSession(): CollabSession | null {
  return current;
}

/**
 * Start (and on leaving, stop) the session for `projectId`. `rev` overrides
 * the device cache's revision, for the signed-out viewer who has none.
 */
export function useCollab(projectId: string, rev?: number) {
  const access = useAccess((s) => (s.projectId === projectId ? s.access : null));
  const loaded = useProject((s) => s.id === projectId && s.screens.length > 0);

  useEffect(() => {
    if (!access || !loaded) return;
    let session: CollabSession | null = null;
    let cancelled = false;
    void (async () => {
      const me = await getAccount().catch(() => null);
      const start = rev ?? cloudRev(projectId);
      if (cancelled || start === undefined) return;
      const author = me?.user && access.actions.includes("edit") ? me.user.id : null;
      usePresence.getState().setMe(me?.user?.id ?? null);
      if (author) setLiveProject(projectId, true);
      session = new CollabSession({
        projectId,
        author,
        rev: start,
        store: useProject as never,
        transport: browserTransport,
        onStatus: (status) => {
          if (author) void liveSaved(projectId, status.rev, status.pending, status.error);
        },
        onPresence: (users) => usePresence.getState().set(users),
        onProposal: (body) => useProposals.getState().receive(body),
        onAgent: (body) => useProposals.getState().agentStep(body),
      });
      void loadProposals(projectId);
      session.start();
      current = session;
    })();
    return () => {
      cancelled = true;
      session?.stop();
      if (current === session) current = null;
      setLiveProject(projectId, false);
      usePresence.getState().clear();
      useProposals.getState().clear();
    };
  }, [projectId, access, loaded, rev]);
}
