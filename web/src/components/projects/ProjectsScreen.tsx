"use client";

/**
 * Projects - reference screen 2.
 *
 * Server projects, including shared memberships, appear before the device
 * index. The existing localStorage cards remain available offline and can be
 * explicitly uploaded after sign-in; opening either kind uses one editor.
 *
 * Phase 9 of docs/BUILD_PLAN.md.
 */

import { magnetic } from "@/components/motion/useMagnetic";
import { SignInNotice } from "@/components/shell/SignInNotice";
import { AccountControl } from "@/components/shell/AccountControl";
import type { Project } from "@/lib/server/repo";
import { importFile } from "@/lib/client/upload";
import { expectJson } from "@/lib/ingest/client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus, Trash2, Upload, FolderPlus } from "lucide-react";
import { Badge, Button, Input, Tabs, cn, type TabItem, EmptyState } from "@/components/ui";
import {
  createProject,
  loadProjects,
  saveProjects,
  touchProject,
  type ProjectRecord,
} from "@/store/projects";
import { forgetHydration } from "@/components/shell/useProjectHydration";
import { clearProject, loadProject, saveProject, getAccount, uploadProject } from "@/store/persist";
import { DEFAULT_STANDARDS, useProject } from "@/store/project";
import { useNewProject } from "@/components/shell/useNewProject";
import type { Alarm, Screen, Variable } from "@/lib/ote/schema";
import type { Binding, ForeignPart } from "@/store/types";

/** What /api/import answers with. */
export interface Imported {
  /** Null for a converted file: there is nothing to write back into. */
  source: string | null;
  sourceId?: string;
  name: string;
  target: { model: string; width: number; height: number };
  screens: Screen[];
  foreign: Record<string, ForeignPart[]>;
  variables: Variable[];
  alarms: Alarm[];
  bindings: Binding[];
  carried: { entries: number; opaqueParts: number; variableRows: number; bindingRows: number; screens?: number; roots?: Record<string, number> };
  warnings: string[];
  /** Which generation of the format the file turned out to be. */
  layout?: "typed" | "struct";
  /** True when the file was in the older layout and was converted. */
  converted?: boolean;
  /** The product and version that wrote it, e.g. "EcoStruxure Operator Terminal Expert 3.4.1 (.vxdz)". */
  product?: string;
  /** Set when the open also added the project to the knowledge base. */
  knowledge?: { id: string; isNew: boolean };
}

type Filter = "all" | "recent" | "starred";

const FILTERS: TabItem<Filter>[] = [
  { id: "all", label: "All" },
  { id: "recent", label: "Recent" },
  { id: "starred", label: "Starred" },
];

function when(at: number) {
  if (at === 0) return "— the built-in demo";
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function ProjectsScreen() {
  const [cloudProjects, setCloudProjects] = useState<Project[]>([]);
  const [cloud, setCloud] = useState(false);
  async function refreshCloud() {
    const me = await getAccount();
    setCloud(!!me.user && me.cloud);
    if (me.user && me.cloud) {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setCloudProjects(body.projects);
    }
  }
  useEffect(() => { void refreshCloud().catch(e => setOpenError(e.message)); }, []);
  const newProject = useNewProject();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => setProjects(loadProjects()), []);

  /**
   * Open an existing .eote. The file goes to /api/import, which keeps the
   * bytes so an export can write back into them, and answers with what it
   * could model. The project is saved under a new id and opened like any
   * other; what was carried rather than modelled is written on its card.
   */
  async function open(file: File) {
    setOpenError(null);
    setOpening(file.name);
    try {
      const response = await importFile(file);
      const data = await expectJson<Imported>(response, "Opening the project");

      const record = createProject(data.name);
      const objects = data.screens.reduce((n, s) => n + s.Children[0].Children.length, 0);
      saveProject({
        id: record.id,
        name: record.name,
        target: data.target,
        screens: data.screens,
        activeScreenId: data.screens[0]?.UniqueId,
        variables: data.variables,
        alarms: data.alarms,
        bindings: data.bindings,
        objectMeta: {},
        screenPlacement: {},
        standards: DEFAULT_STANDARDS,
        versions: [],
        chat: [],
        source: data.source ?? undefined,
        sourceId: data.sourceId,
        layout: data.layout,
        foreign: data.foreign ?? {},
      });
      const grid = data.carried.roots?.Grid ?? 0;
      const carried = [
        data.carried.screens
          ? `${data.carried.screens} screen${data.carried.screens === 1 ? "" : "s"}${grid ? ` (${grid} on a Grid layout)` : ""}`
          : "",
        data.carried.opaqueParts ? `${data.carried.opaqueParts} objects` : "",
        data.carried.variableRows ? `${data.carried.variableRows} variables` : "",
        data.carried.bindingRows ? `${data.carried.bindingRows} bindings` : "",
      ].filter(Boolean);
      touchProject(record.id, {
        screens: data.screens.length,
        objects,
        tags: data.variables.length,
        alarms: data.alarms.length,
        bindings: data.bindings.length,
        target: `${data.target.model} · ${data.target.width} × ${data.target.height}`,
        intent:
          (data.converted
            ? `Converted ${file.name} from the older 3.x layout — it exports as a new 4.4 .eote`
            : `Opened ${file.name}`) +
          // Only worth saying for a .vxdz: an .eote is always the modern
          // layout, and an engineer who opened one does not need telling.
          (/\.vxdz$/i.test(file.name) && data.layout === "typed"
            ? " — modern layout, and it exports as an .eote"
            : "") +
          (carried.length ? ` — carrying ${carried.join(", ")} the editor does not model` : "") +
          (data.screens.some((s) => s.Type === "Content") ? ` — ${data.screens.filter((s) => s.Type === "Content").length} of its screens are content screens` : "") +
          // Nothing to show is said, rather than left as an empty canvas.
          (data.screens.length === 0 ? " — nothing it holds can be drawn yet, but it all exports back unchanged" : ""),
      });
      useProject.getState().reset();
      router.push(`/project/${record.id}`);
    } catch (caught) {
      setOpenError(caught instanceof Error ? caught.message : "could not open that file");
    } finally {
      setOpening(null);
    }
  }

  function write(next: ProjectRecord[]) {
    setProjects(next);
    saveProjects(next);
  }

  // createProject() writes the index entry and useNewProject navigates; the
  // project opens blank because nothing is saved under its id yet.
  function create() {
    newProject(name);
    setName("");
    setCreating(false);
  }

  /** Deleting takes the contents too, not only the card that pointed at them. */
  function remove(id: string) {
    const doomed = projects.find((p) => p.id === id);
    if (!window.confirm(`Delete ${doomed?.name ?? "this project"}? It is removed from this browser and cannot be brought back.`)) return;
    write(projects.filter((p) => p.id !== id));
    clearProject(id);
  }

  /** The card, and the name inside the saved project, which is what an export writes. */
  function renameLocal(id: string, current: string) {
    const asked = window.prompt("Rename project", current)?.trim();
    if (!asked || asked === current) return;
    const name = asked.replace(/\s+/g, "_");
    const saved = loadProject(id);
    if (saved) saveProject({ ...saved, name });
    touchProject(id, { name });
    setProjects(loadProjects());
  }

  /** A second project from this one's current state. Its history and conversation stay behind. */
  function duplicateLocal(id: string, current: string) {
    const saved = loadProject(id);
    if (!saved) {
      setOpenError(`${current} has nothing saved in this browser to copy.`);
      return;
    }
    const record = createProject(`${current}_copy`);
    saveProject({ ...saved, id: record.id, name: record.name, versions: [], chat: [] });
    touchProject(record.id, { screens: saved.screens.length, tags: saved.variables.length, alarms: saved.alarms.length, bindings: saved.bindings.length, intent: `Copied from ${current}` });
    setProjects(loadProjects());
  }

  async function onServer(path: string, init: RequestInit, doing: string) {
    setOpenError(null);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Could not ${doing}`);
      }
      await refreshCloud();
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : `Could not ${doing}`);
    }
  }

  function renameCloud(id: string, current: string) {
    const name = window.prompt("Rename project", current)?.trim();
    if (!name || name === current) return;
    void onServer(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, "rename that project");
  }

  const all = projects.filter(p => !cloudProjects.some(c => c._id === p.id));
  const shown =
    filter === "starred"
      ? all.filter((p) => p.starred)
      : filter === "recent"
        ? [...all].sort((a, b) => b.openedAt - a.openedAt).slice(0, 6)
        : all;

  return (
    <div className="space-y-6">
      <AccountControl signIn={false} />
      <SignInNotice reason="Sign in to see the projects saved on the server. The ones listed here are stored in this browser." />
      {cloud && <section className="space-y-3" aria-label="Cloud projects">
        <h2 className="text-sm font-semibold">Saved on the server</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cloudProjects.map(p => <li key={p._id} className="glass glass-dense rounded-2xl p-5">
            <Link className="focus-ring text-sm font-semibold hover:text-brand-400" href={`/project/${p._id}`}>{p.name}</Link>
            <p className="mt-2 text-xs text-text-muted">Version {p.rev} · {p.target.model}</p>
            <div className="mt-2 flex gap-3 text-xs">
              <button type="button" className="focus-ring text-brand-400" onClick={() => renameCloud(p._id, p.name)}>Rename</button>
              <button type="button" className="focus-ring text-brand-400" onClick={() => void onServer(`/api/projects/${p._id}/duplicate`, { method: "POST" }, "copy that project")}>Duplicate</button>
            </div>
          </li>)}
        </ul>
      </section>}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          items={FILTERS}
          value={filter}
          onChange={setFilter}
          variant="pill"
          aria-label="Project filter"
        />
        <span className="text-figure text-xs text-text-faint">
          {all.length} project{all.length === 1 ? "" : "s"}
        </span>
        <input
          ref={picker}
          type="file"
          accept=".eote,.vxdz,.vdz"
          className="hidden"
          aria-label="Open a project file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void open(file);
          }}
        />
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => picker.current?.click()}
          disabled={opening !== null}
          icon={<Upload size={16} />}
          title="Open an existing EcoStruxure Operator Terminal Expert project: an .eote or a .vxdz. Everything the editor does not model is carried through unchanged; a .vxdz older than 3.4.1 is converted and exports as a new 4.4 project."
        >
          {opening ? `Opening ${opening}…` : "Open project"}
        </Button>
        <Button
          variant="primary"
          onClick={() => setCreating((c) => !c)}
          icon={<Plus size={16} />}
        >
          New project
        </Button>
      </div>

      {openError && (
        <p className="rounded-panel border border-status-warn/30 bg-status-warn/[0.08] px-3 py-2 text-xs text-status-warn">
          {openError}
        </p>
      )}

      {creating && (
        <div className="card flex items-center gap-2 p-3">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Water_Treatment"
            aria-label="New project name"
            className="max-w-sm"
          />
          <Button variant="primary" onClick={create} disabled={!name.trim()}>
            Create
          </Button>
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {shown.map((project) => (
          <li key={project.id} className="group relative">
            <Link
              href={`/project/${project.id}`}
              {...magnetic}
              className={cn(
                "glass glass-dense spotlight magnetic focus-ring flex min-h-44 flex-col rounded-2xl p-5",
                "hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-brand-500)_45%,transparent),var(--elev-3)]",
              )}
            >
              <div className="flex items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400/25 to-brand-600/10 text-brand-400 ring-1 ring-brand-500/25">
                  <FolderOpen size={16} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate pt-1 text-sm font-semibold">
                  {project.name}
                </span>
              </div>

              {/* What it was asked for, which is what the project is. Named
                  projects get their own sentence back rather than a count. */}
              {project.intent && (
                <span className="mt-2.5 line-clamp-2 block text-xs leading-relaxed text-text-muted">
                  {project.intent}
                </span>
              )}

              <span className="mt-auto block truncate pt-3 text-[11px] text-text-faint">
                {project.openedAt === 0
                  ? "The built-in demo"
                  : `Opened ${when(project.openedAt)}`}
                {project.target && ` · ${project.target}`}
              </span>

              {/* Only counts that are non-zero: a wall of zeroes on a project
                  nobody has built yet says less than nothing. */}
              {/* Figures, not badges. Five pills wrapped to three lines and
                  read as tags rather than as a measurement of the project. */}
              {project.screens ? (
                <span className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line-subtle pt-2.5">
                  {(
                    [
                      ["screens", project.screens],
                      ["objects", project.objects],
                      ["tags", project.tags],
                      ["alarms", project.alarms],
                    ] as const
                  )
                    .filter(([, n]) => (n ?? 0) > 0)
                    .map(([noun, n]) => (
                      <span key={noun} className="flex flex-col">
                        <span className="text-figure text-sm font-semibold leading-none text-text-secondary">
                          {n!.toLocaleString()}
                        </span>
                        <span className="label-eyebrow pt-0.5">{noun}</span>
                      </span>
                    ))}
                </span>
              ) : (
                <span className="mt-3 border-t border-line-subtle pt-2.5">
                  <Badge tone="warn">empty — nothing built yet</Badge>
                </span>
              )}
            </Link>

            <div className="mt-2 flex gap-3 text-xs">
              <button type="button" className="focus-ring text-brand-400" onClick={() => renameLocal(project.id, project.name)}>Rename</button>
              <button type="button" className="focus-ring text-brand-400" onClick={() => duplicateLocal(project.id, project.name)}>Duplicate</button>
            </div>
            {cloud && <button className="focus-ring mt-2 text-xs text-brand-400" onClick={() => {
              // The next open has to read the server's copy, role and all, even if this
              // page load already filled the store from the browser's.
              void uploadProject(project.id).then(() => { forgetHydration(); return refreshCloud(); }).catch(e => setOpenError(e.message));
            }}>Upload to cloud</button>}
            {(
              <button
                type="button"
                aria-label={`Delete ${project.name}`}
                title="Delete project"
                onClick={() => remove(project.id)}
                className="focus-ring absolute right-2 top-2 rounded-md p-1.5 text-text-faint opacity-0 transition hover:bg-surface-hover hover:text-status-alarm focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}

        {shown.length === 0 && (
          <li className="col-span-full rounded-2xl border border-dashed border-line-strong bg-surface-panel/40">
            <EmptyState
              icon={FolderPlus}
              title="No projects yet"
              body="A project is a tag list, a set of screens and the bindings between them. Start one and the workspace asks what to build."
              hints={[
                { key: "New", label: "Start from nothing, a tag export, or a plant you describe" },
                { key: "Open", label: "Or bring an .eote or .vxdz you already have" },
              ]}
            />
          </li>
        )}
      </ul>

      <p className="text-xs text-text-faint">
        Projects are stored in this browser. Export writes an .eote, whichever
        format the project was opened from, because .eote is what we write;
        signed-in projects also save privately on this server.
      </p>
    </div>
  );
}
