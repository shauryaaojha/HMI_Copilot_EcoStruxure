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

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, Tabs, cn, type TabItem } from "@/components/ui";

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  openedAt: number;
  /** Present once the project has been generated at least once. */
  screens?: number;
  starred?: boolean;
}

const KEY = "hmi-copilot-projects";

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

function saveProjects(list: ProjectRecord[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // private mode: the list just does not persist
  }
}

/** The project the fixtures load into; it exists whether or not it was saved. */
const DEMO: ProjectRecord = {
  id: "demo",
  name: "Pump_Station_Demo",
  createdAt: 0,
  openedAt: 0,
  screens: 1,
};

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
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => setProjects(loadProjects()), []);

  function write(next: ProjectRecord[]) {
    setProjects(next);
    saveProjects(next);
  }

  function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const record: ProjectRecord = {
      id: `p${Date.now().toString(36)}`,
      name: trimmed.replace(/\s+/g, "_"),
      createdAt: Date.now(),
      openedAt: Date.now(),
    };
    write([record, ...projects]);
    setName("");
    setCreating(false);
    router.push(`/project/${record.id}`);
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
        <Button
          variant="primary"
          className="ml-auto"
          onClick={() => setCreating((c) => !c)}
          icon={<Plus size={16} />}
        >
          New project
        </Button>
      </div>

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

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((project) => (
          <li key={project.id} className="group relative">
            <Link
              href={`/project/${project.id}`}
              className={cn(
                "focus-ring flex h-40 flex-col rounded-panel border border-line-subtle bg-surface-raised p-4 transition",
                "hover:border-brand-400",
              )}
            >
              <FolderOpen size={22} aria-hidden className="text-brand-400" />
              <span className="mt-auto block truncate text-sm font-semibold">
                {project.name}
              </span>
              <span className="mt-1 block text-xs text-text-muted">
                {project.openedAt === 0
                  ? "The built-in demo"
                  : `Last opened ${when(project.openedAt)}`}
              </span>
              {project.screens !== undefined && (
                <span className="mt-2">
                  <Badge tone="neutral">
                    {project.screens} {project.screens === 1 ? "screen" : "screens"}
                  </Badge>
                </span>
              )}
            </Link>

            {project.id !== "demo" && (
              <button
                type="button"
                aria-label={`Delete ${project.name}`}
                title="Delete project"
                onClick={() => write(projects.filter((p) => p.id !== project.id))}
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
