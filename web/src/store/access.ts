"use client";

/**
 * What the person at this browser may do to the project on screen.
 *
 * A browser-only project, or one on a laptop in local mode, belongs to whoever
 * is at the keyboard: everything is allowed and nothing here changes. A server
 * project opened by a member, or through a share link, carries a role, and the
 * editor must not offer an edit the server would refuse. Every editing
 * affordance asks `useCanEdit()` rather than reading the role itself, so the
 * rule "viewers and commenters see, editors change" lives in one place.
 *
 * The server stays the authority: hiding a button is a courtesy, the route's
 * access check is the rule (src/lib/server/access.ts).
 */

import { create } from "zustand";

/** Mirrors Role in src/lib/server/repo.ts without importing server code. */
export type AccessRole = "owner" | "editor" | "commenter" | "viewer";
/** Mirrors Action in src/lib/server/access.ts. */
export type AccessAction = "read" | "comment" | "edit" | "manage" | "export";

/** The access the server reported for one project, as GET /api/projects/[id] returns it. */
export interface ProjectAccess {
  role: AccessRole | null;
  actions: AccessAction[];
  /** "member" for a project member, "share" for a signed-out share-link visitor. */
  via: "member" | "share";
}

interface AccessState {
  /** The project the access below belongs to. */
  projectId: string | null;
  /** Null for a project with no server copy: the local engineer may do anything. */
  access: ProjectAccess | null;
  set: (projectId: string, access: ProjectAccess | null) => void;
  clear: () => void;
}

/** One small store, so components re-render when a project's role arrives. */
export const useAccess = create<AccessState>()((set) => ({
  projectId: null,
  access: null,
  set: (projectId, access) => set({ projectId, access }),
  clear: () => set({ projectId: null, access: null }),
}));

/**
 * Whether an action is allowed, outside React. A project without a server
 * role is the engineer's own and allows everything.
 */
export function allowed(action: AccessAction, state: Pick<AccessState, "access"> = useAccess.getState()): boolean {
  if (!state.access) return true;
  return state.access.actions.includes(action);
}

/** Whether this browser may perform `action` on the open project. */
export function useCan(action: AccessAction): boolean {
  return useAccess((s) => allowed(action, s));
}

/**
 * The one question every editing affordance asks: toolbar tools, the Insert
 * menu, the chat composer, delete, move, resize, generate, regenerate.
 */
export function useCanEdit(): boolean {
  return useCan("edit");
}
