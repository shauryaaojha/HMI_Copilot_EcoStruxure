/**
 * Keeping the project across a page change, a reload and a Fast Refresh.
 *
 * The store is module state, so leaving the workspace for /project/x/tags used
 * to be survivable and pressing F5 was not - and in development every edit to a
 * store file reset the module and took the generated screens with it. An
 * engineer who spent two minutes describing a station does not expect to lose
 * it by opening the tag list.
 *
 * localStorage, not IndexedDB: a project is a few hundred KB of JSON at worst,
 * writing is synchronous and debounced, and a read has to be available during
 * the first render or the canvas flashes the demo fixture before the real
 * project arrives.
 */

import type { Alarm, Screen, Variable } from "@/lib/ote/schema";
import type {
  Binding,
  ChatMessage,
  ObjectMeta,
  ScreenPlacement,
  Standards,
  TagImport,
  Version,
} from "./types";

const KEY = (id: string) => `hmi-copilot:project:${id}`;

/** Bumped whenever the shape below changes, so a stale save is ignored. */
const VERSION = 3;

/** Exactly what is worth surviving a reload - not selection, not the run log. */
export interface PersistedProject {
  v: number;
  id: string;
  name: string;
  target: { model: string; width: number; height: number };
  screens: Screen[];
  activeScreenId?: string;
  variables: Variable[];
  alarms: Alarm[];
  bindings: Binding[];
  objectMeta: Record<string, ObjectMeta>;
  screenPlacement: Record<string, ScreenPlacement>;
  standards: Standards;
  versions: Version[];
  chat: ChatMessage[];
  tagImport?: TagImport;
  savedAt: number;
}

const available = () => typeof window !== "undefined" && !!window.localStorage;

export function loadProject(id: string): PersistedProject | null {
  if (!available()) return null;
  try {
    const raw = window.localStorage.getItem(KEY(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedProject;
    // A save from an older shape is discarded rather than half-applied: a
    // project missing a field the canvas dereferences is worse than no project.
    if (parsed.v !== VERSION || !Array.isArray(parsed.screens)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveProject(project: Omit<PersistedProject, "v" | "savedAt">): number {
  const savedAt = Date.now();
  if (!available()) return savedAt;
  try {
    window.localStorage.setItem(
      KEY(project.id),
      JSON.stringify({ ...project, v: VERSION, savedAt }),
    );
  } catch {
    // Quota or private mode. The project stays in memory; autosave just stops
    // claiming to have happened, which the status bar reads off savedAt.
  }
  return savedAt;
}

export function clearProject(id: string) {
  if (!available()) return;
  try {
    window.localStorage.removeItem(KEY(id));
  } catch {
    /* nothing to do */
  }
}
