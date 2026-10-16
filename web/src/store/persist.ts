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
import { snapshotRequest } from "@/lib/client/snapshot";
import type { PlantModel } from "@/lib/plant/model";
import type {
  Binding,
  ChatMessage,
  CompositeInstance,
  ForeignPart,
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
  /** Optional so a save from before handles existed still loads; hydrate backfills. */
  handles?: Record<string, string>;
  handleSeq?: number;
  /** The import id of the .eote this was opened from, if it was. */
  source?: string;
  /** Original upload retained even when a legacy project exports by conversion. */
  sourceId?: string;
  layout?: "typed" | "struct";
  /** Carried objects per screen, when the project was opened from a file. */
  foreign?: Record<string, ForeignPart[]>;
  /** Composite instances, so an indicator is still an indicator after a reload. */
  composites?: Record<string, CompositeInstance>;
  /** Screen recipes, for regeneration. Optional: older saves have none. */
  programs?: Record<string, import("@/lib/program/program").ScreenProgram>;
  plant?: PlantModel;
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

export function saveProject(project: Omit<PersistedProject, "v" | "savedAt">, cloudDelay = 1500): number {
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
  scheduleCloud({ ...project, v: VERSION, savedAt }, cloudDelay);
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

/**
 * Server persistence is a write-through layer over the existing device cache.
 * Each project remembers the revision it actually read, never a revision fetched
 * just before overwriting. Dirty caches survive reloads; a conflict pauses sync
 * until the engineer explicitly reloads or keeps their copy. Requests for one
 * project are serialized so a slow response cannot acknowledge a newer edit.
 */
export interface Account { user: { id: string; name: string } | null; cloud: boolean; providers: string[] }
export type SyncStatus = "Saved" | "Saving…" | "Offline - saved on this device" | "Changed elsewhere";
interface SyncMeta { userId: string; rev: number; dirty: boolean }
interface SyncEntry { base?: SyncMeta; status: SyncStatus; latest?: PersistedProject; conflict?: { rev: number; snapshot: PersistedProject }; timer?: ReturnType<typeof setTimeout>; running?: Promise<void>; loading?: Promise<PersistedProject | null>; error?: string }
const sync = new Map<string, SyncEntry>();
let account: Promise<Account> | undefined;
export function getAccount(refresh = false): Promise<Account> {
  if (refresh) account = undefined;
  return account ??= fetch("/api/me", { cache: "no-store" }).then(async r => {
    if (!r.ok) throw new Error("Account service unavailable");
    return r.json() as Promise<Account>;
  }).catch(e => { account = undefined; throw e; });
}
const META = (id: string) => `hmi-copilot:sync:${id}`;
function meta(id: string): SyncMeta | null {
  const e = sync.get(id);
  if (e?.base) return e.base;
  try {
    const value = JSON.parse(localStorage.getItem(META(id)) ?? "null") as SyncMeta | null;
    if (e && value) e.base = value;
    return value;
  } catch { return null; }
}
function writeMeta(id: string, value: SyncMeta) { entry(id).base = value; try { localStorage.setItem(META(id), JSON.stringify(value)); } catch { /* Memory work still survives until navigation. */ } }
function entry(id: string): SyncEntry {
  let value = sync.get(id);
  if (!value) { value = { status: "Saved" }; sync.set(id, value); }
  return value;
}
function announce(id: string, status: SyncStatus) {
  entry(id).status = status;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("hmi-cloud-status"));
}
export function cloudStatus(id: string) { return entry(id).status; }
export function cloudError(id: string) { return entry(id).error; }
function cache(project: PersistedProject) {
  try { localStorage.setItem(KEY(project.id), JSON.stringify(project)); } catch { /* Reported by the normal local cache path. */ }
}
async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not save project");
  return body;
}
function scheduleCloud(project: PersistedProject, delay = 1500) {
  const e = entry(project.id);
  e.latest = project;
  const m = meta(project.id);
  if (m) writeMeta(project.id, { ...m, dirty: true });
  if (e.timer) clearTimeout(e.timer);
  if (e.conflict) return;
  e.timer = setTimeout(() => { void syncProject(project.id); }, delay);
}
export async function syncProject(id: string): Promise<void> {
  const e = entry(id);
  if (e.running) { await e.running; if (e.latest && !e.conflict) return syncProject(id); return; }
  e.running = (async () => {
    let attempted: PersistedProject | undefined;
    try {
      if (e.loading) await e.loading;
      const me = await getAccount();
      if (!me.cloud || !me.user || e.conflict) return;
      const m = meta(id);
      // A different account's device cache is never silently uploaded.
      if (m && m.userId !== me.user.id) return;
      const project = e.latest ?? loadProject(id);
      if (!project) return;
      attempted = project;
      e.latest = undefined;
      writeMeta(id, { userId: me.user.id, rev: m?.rev ?? 0, dirty: true });
      announce(id, "Saving…");
      const response = await fetch(m?.rev ? `/api/projects/${id}` : "/api/projects", {
        method: m?.rev ? "PUT" : "POST", ...await snapshotRequest(project, m?.rev),
      });
      if (response.status === 409) {
        let current = await response.json();
        if (!current.snapshot) current = await responseJson(await fetch(`/api/projects/${id}`, { cache: "no-store" }));
        e.conflict = { rev: current.rev, snapshot: current.snapshot };
        e.latest ??= project;
        announce(id, "Changed elsewhere"); return;
      }
      const saved = await responseJson(response);
      writeMeta(id, { userId: me.user.id, rev: saved.rev ?? saved.project.rev, dirty: !!e.latest });
      const sourceId = saved.snapshot?.sourceId ?? saved.project?.sourceId;
      const source = saved.snapshot?.source ?? (project.source ? sourceId : undefined);
      if (source && source !== project.source) {
        project.source = source;
        project.sourceId = source;
        const pending = e.latest as PersistedProject | undefined;
        if (pending) { pending.source = source; pending.sourceId = source; }
        cache(e.latest ?? project);
        window.dispatchEvent(new CustomEvent("hmi-source-promoted", { detail: { id, source } }));
      }
      e.error = undefined;
      announce(id, e.latest ? "Saving…" : "Saved");
    } catch (error) {
      e.latest ??= attempted;
      e.error = error instanceof Error ? error.message : "Could not save project";
      announce(id, "Offline - saved on this device");
    }
  })();
  await e.running;
  e.running = undefined;
}
/** Read before editing. Dirty local work wins over a newer server snapshot. */
export function loadCloudProject(id: string): Promise<PersistedProject | null> {
  const e = entry(id);
  if (e.loading) return e.loading;
  e.loading = (async () => {
    try {
      const me = await getAccount();
      if (!me.cloud || !me.user) return null;
      const response = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      if (response.status === 404) return null;
      const current = await responseJson(response);
      const m = meta(id);
      if (m?.userId === me.user.id && m.dirty) {
        if (m.rev !== current.rev) { e.conflict = current; announce(id, "Changed elsewhere"); }
        else { const local = loadProject(id); if (local) scheduleCloud(local); }
        return loadProject(id);
      }
      if (e.latest) { e.conflict = current; announce(id, "Changed elsewhere"); return null; }
      writeMeta(id, { userId: me.user.id, rev: current.rev, dirty: false });
      cache(current.snapshot);
      return current.snapshot as PersistedProject;
    } catch (error) {
      e.error = error instanceof Error ? error.message : "Could not load project";
      announce(id, "Offline - saved on this device"); return null;
    }
  })();
  return e.loading.finally(() => { e.loading = undefined; });
}
export async function resolveCloudConflict(id: string, keep: boolean): Promise<PersistedProject | null> {
  const e = entry(id); const conflict = e.conflict;
  if (!conflict) return null;
  const me = await getAccount(); if (!me.user) return null;
  e.conflict = undefined;
  writeMeta(id, { userId: me.user.id, rev: conflict.rev, dirty: keep });
  if (keep) { e.latest ??= loadProject(id) ?? undefined; await syncProject(id); return null; }
  e.latest = undefined;
  if (e.timer) clearTimeout(e.timer);
  cache(conflict.snapshot); announce(id, "Saved");
  return conflict.snapshot;
}
/** Explicit migration of a device-only project into the signed-in account. */
export async function uploadProject(id: string) {
  const account = await getAccount();
  if (!account.cloud || !account.user) throw new Error("Sign in before uploading a project");
  const base = meta(id);
  if (base && base.userId !== account.user.id) throw new Error("Sign into the account that owns this device cache before uploading it");
  const project = loadProject(id);
  if (!project) throw new Error("Open this project once before uploading it");
  entry(id).latest = project;
  await syncProject(id);
  if (entry(id).error) throw new Error(entry(id).error);
}
