"use client";

/**
 * Who else is in the shared project right now, and where. Filled from the
 * project stream's presence events (lib/collab/sync.ts); read by the header's
 * avatar row and the canvas overlay of other people's selections and cursors.
 * Never part of the project, never saved.
 */
import { create } from "zustand";
import type { Presence } from "@/lib/collab/types";

interface PresenceState {
  /** Everyone with a live heartbeat, this browser's user included. */
  users: Presence[];
  /** This browser's user id, so the overlay leaves out its own selection. */
  me: string | null;
  set: (users: Presence[]) => void;
  setMe: (me: string | null) => void;
  clear: () => void;
}

export const usePresence = create<PresenceState>()((set) => ({
  users: [],
  me: null,
  set: (users) => set({ users }),
  setMe: (me) => set({ me }),
  clear: () => set({ users: [], me: null }),
}));

/** The other people here, without this browser's own entry. */
export function others(state: Pick<PresenceState, "users" | "me">): Presence[] {
  return state.users.filter((u) => u.userId !== state.me);
}

/** A stable colour per person, so their outline and cursor match their avatar. */
export function colorFor(userId: string): string {
  const palette = ["#e8590c", "#2f9e44", "#1c7ed6", "#ae3ec9", "#f08c00", "#0c8599", "#d6336c", "#5c940d"];
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
