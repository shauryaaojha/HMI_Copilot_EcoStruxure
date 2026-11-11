/**
 * Which model the engineer picked in the chat, by menu id (lib/ai/menu.ts).
 *
 * A per-browser convenience, kept in localStorage: null means "whatever the
 * server's default is". The chat and the agent send it with every request;
 * the server maps it to a model it holds a key for, or ignores it.
 */

import { create } from "zustand";

const KEY = "hmi-copilot.model";

interface ModelChoice {
  id: string | null;
  set: (id: string | null) => void;
  /** Reads the saved pick once the page is on the client; a server render has none. */
  hydrate: () => void;
}

export const useModelChoice = create<ModelChoice>((set) => ({
  id: null,
  set: (id) => {
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      // Private window or blocked storage: the pick lasts the page.
    }
    set({ id });
  },
  hydrate: () => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) set({ id: saved });
    } catch {
      // Nothing saved, or storage is unavailable.
    }
  },
}));
