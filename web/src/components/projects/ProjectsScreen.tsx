"use client";

/**
 * Projects - reference screen 2.
 *
 * The list is kept in localStorage rather than mocked, so New Project genuinely
 * creates one and it is still there after a reload. There is no backend to put
 * it in yet; when there is, this becomes a fetch and nothing above it changes.
 *
 * Phase 9 of docs/BUILD_PLAN.md.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus, Trash2, Upload } from "lucide-react";
import { Badge, Button, Input, Tabs, cn, type TabItem } from "@/components/ui";
import {
  DEMO,
  DEMO_ID,
  createProject,
  loadProjects,
  saveProjects,
  touchProject,
  type ProjectRecord,
} from "@/store/projects";
import { clearProject, saveProject } from "@/store/persist";
import { DEFAULT_STANDARDS, useProject } from "@/store/project";
import { useNewProject } from "@/components/shell/useNewProject";
import type { Alarm, Screen, Variable } from "@/lib/ote/schema";
import type { Binding } from "@/store/types";

/** What /api/import answers with. */
interface Imported {
  source: string;
  name: string;
  target: { model: string; width: number; height: number };
  screens: Screen[];
  variables: Variable[];
  alarms: Alarm[];
  bindings: Binding[];
  carried: { entries: number; opaqueParts: number; variableRows: number; bindingRows: number };
  warnings: string[];
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
      const response = await fetch("/api/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: await file.arrayBuffer(),
      });
      const data = (await response.json()) as Imported & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `import failed (${response.status})`);

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
        source: data.source,
      });
      const carried = [
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
          `Opened ${file.name}` +
          (carried.length ? ` — carrying ${carried.join(", ")} the editor does not model` : ""),
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
    write(projects.filter((p) => p.id !== id));
    clearProject(id);
  }

  const all = [DEMO, ...projects];
  const shown =
    filter === "starred"
      ? all.filter((p) => p.starred)
      : filter === "recent"
        ? [...all].sort((a, b) => b.openedAt - a.openedAt).slice(0, 6)
        : all;

  return (
    <div className="space-y-6">
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
          accept=".eote"
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
          title="Open an existing EcoStruxure Operator Terminal Expert project. Everything the editor does not model is carried through unchanged."
        >
          {opening ? `Opening ${opening}…` : "Open .eote"}
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
        <div className="flex items-center gap-2 rounded-panel border border-line bg-surface-raised p-3">
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
              className={cn(
                "focus-ring flex min-h-40 flex-col rounded-panel border border-line-subtle bg-surface-raised p-4 transition",
                "hover:-translate-y-0.5 hover:border-brand-500/50",
              )}
              style={{ boxShadow: "var(--elev-1)" }}
            >
              <div className="flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-400">
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

            {project.id !== DEMO_ID && (
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
          <li className="col-span-full rounded-panel border border-dashed border-line p-10 text-center text-sm text-text-muted">
            Nothing here yet.
          </li>
        )}
      </ul>

      <p className="text-xs text-text-faint">
        Projects are stored in this browser. A generated project is exported as an
        .eote from the Export screen; nothing is uploaded anywhere.
      </p>
    </div>
  );
}
