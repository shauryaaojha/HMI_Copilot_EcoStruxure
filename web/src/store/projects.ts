/**
 * The list of projects, and starting a new one.
 *
 * Two separate things live in localStorage and it is worth keeping them
 * straight: `./persist` stores a project's *contents* under its id, and this
 * stores the *index* - which projects exist, what they are called, when they
 * were last opened. The Projects page reads the index; the workspace reads the
 * contents. When there is a backend, this becomes a fetch and nothing above it
 * changes.
 *
 * It lives here rather than in the Projects page because "start a new project"
 * is reached from three places now - the Projects page, the top bar and the
 * Copilot pane - and three copies of it would be three chances to forget to
 * register the project that was just created.
 */

const KEY = "hmi-copilot-projects";

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  openedAt: number;
  /** Present once the project has screens; shown on the card. */
  screens?: number;
  starred?: boolean;
}

/**
 * The project the fixtures load into. It exists whether or not it was ever
 * saved, and it is the only id that opens on the demo screen rather than on an
 * empty canvas - see useProjectHydration.
 */
export const DEMO_ID = "demo";

export const DEMO: ProjectRecord = {
  id: DEMO_ID,
  name: "Pump_Station_Demo",
  createdAt: 0,
  openedAt: 0,
  screens: 1,
};

export function loadProjects(): ProjectRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as ProjectRecord[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveProjects(list: ProjectRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // private mode: the list just does not persist
  }
}

/** "Untitled_3" - the next free one, so two new projects are distinguishable. */
function nextName(existing: ProjectRecord[]): string {
  const taken = new Set(existing.map((p) => p.name));
  if (!taken.has("Untitled")) return "Untitled";
  for (let n = 2; ; n++) if (!taken.has(`Untitled_${n}`)) return `Untitled_${n}`;
}

/**
 * Registers a new, empty project and returns it. The contents are not written
 * here: an id with nothing saved under it opens blank, which is exactly what a
 * new project is.
 */
export function createProject(name?: string): ProjectRecord {
  const existing = loadProjects();
  const record: ProjectRecord = {
    id: `p${Date.now().toString(36)}`,
    name: (name?.trim() || nextName(existing)).replace(/\s+/g, "_"),
    createdAt: Date.now(),
    openedAt: Date.now(),
    screens: 0,
  };
  saveProjects([record, ...existing]);
  return record;
}

export function forgetProject(id: string) {
  saveProjects(loadProjects().filter((p) => p.id !== id));
}

/**
 * Keeps a card in step with the project behind it, so the Projects page does
 * not claim "0 screens" over a project with four. The demo is never written -
 * it is not in the list, it is prepended to it.
 */
export function touchProject(id: string, patch: Partial<ProjectRecord>) {
  if (id === DEMO_ID) return;
  const list = loadProjects();
  const at = list.findIndex((p) => p.id === id);
  if (at === -1) return;
  const next = [...list];
  next[at] = { ...next[at], ...patch, openedAt: Date.now() };
  saveProjects(next);
}
