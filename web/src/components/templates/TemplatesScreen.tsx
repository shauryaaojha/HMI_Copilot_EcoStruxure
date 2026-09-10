"use client";

/**
 * Templates & Library - reference screen 4.
 *
 * Every card places real OTE parts on the active screen, built by the same
 * factories the generator uses. The preview beside each one is drawn by
 * ScreenRenderer from those very parts, so what is previewed is what is placed
 * and what is exported.
 *
 * Phase 9 of docs/BUILD_PLAN.md.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import type { Part, Screen } from "@/lib/ote/schema";
import { useProject } from "@/store/project";
import { ScreenRenderer } from "@/components/canvas/ScreenRenderer";
import { Badge, Button, Input, Tabs, cn, type TabItem } from "@/components/ui";
import { CATEGORIES, TEMPLATES, type Template } from "./templates";

/**
 * A preview part's id, fixed by where it sits rather than drawn at random.
 *
 * The parts come out of lib/ote/parts.ts, which stamps every one with
 * crypto.randomUUID() - correct for a part being placed on a real screen, and
 * wrong for a preview. This page renders on the server and again on the client,
 * ScreenRenderer writes UniqueId into data-object-id, and the two passes drew
 * different ids, so React reported a hydration mismatch it could not patch up
 * and the dev overlay sat on "1 Issue" on every visit.
 *
 * Kept in the uuid shape the schema asks for, and seeded with the template's
 * own index so ids stay unique across the whole grid of cards, not just within
 * one of them.
 */
function previewId(templateIndex: number, partIndex: number): string {
  const tail =
    templateIndex.toString(16).padStart(6, "0") +
    partIndex.toString(16).padStart(6, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

/** Wraps a template's parts in a throwaway screen, purely to preview them. */
function previewScreen(template: Template): Screen {
  const t = TEMPLATES.indexOf(template);
  const parts = template
    .build({ left: 8, top: 8 }, 1)
    .map((part, i) => ({ ...part, UniqueId: previewId(t, i) }));
  return {
    Type: "Screen",
    UniqueId: "00000000-0000-4000-8000-000000000000",
    Name: template.name,
    Children: [
      {
        Type: "ViewBox",
        UniqueId: "00000000-0000-4000-8000-000000000001",
        Name: template.name,
        Width: template.size.width + 16,
        Height: template.size.height + 16,
        Children: parts,
      },
    ],
  };
}

/**
 * Somewhere the new parts will not land on top of what is already there:
 * below the lowest object, snapped to the grid.
 */
function freeSpotBelow(parts: Part[], gridSize: number) {
  const bottom = parts.reduce(
    (lowest, part) => Math.max(lowest, part.Location.Top + part.Height),
    0,
  );
  const top = Math.ceil((bottom + 16) / gridSize) * gridSize;
  return { left: gridSize * 2, top };
}

export function TemplatesScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");

  const screens = useProject((s) => s.screens);
  const activeScreenId = useProject((s) => s.activeScreenId);
  const standards = useProject((s) => s.standards);
  const appendObject = useProject((s) => s.appendObject);
  const select = useProject((s) => s.select);
  const snapshot = useProject((s) => s.snapshot);
  const log = useProject((s) => s.log);

  const screen = screens.find((s) => s.UniqueId === activeScreenId) ?? screens[0];

  const tabs: TabItem<string>[] = CATEGORIES.map((c) => ({ id: c, label: c }));

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return TEMPLATES.filter((template) => {
      if (category !== "All" && template.category !== category) return false;
      if (!needle) return true;
      return (
        template.name.toLowerCase().includes(needle) ||
        template.description.toLowerCase().includes(needle)
      );
    });
  }, [category, query]);

  function use(template: Template) {
    if (!screen) return;
    const existing = screen.Children[0].Children;
    const at = freeSpotBelow(existing, standards.gridSize);
    // Numbering continues from what is already on the screen, so a second pump
    // block is PUMP 2 rather than a second PUMP 1.
    const n =
      existing.filter((p) => p.Name.startsWith(template.id.split("-")[0].toUpperCase()))
        .length + 1;

    const parts = template.build(at, n);
    for (const part of parts) appendObject(screen.UniqueId, part);
    select(parts.map((p) => p.UniqueId));
    snapshot(`Placed template: ${template.name}`);
    log(`Placed ${template.name} — ${parts.length} objects`);
    router.push(`/project/${projectId}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          items={tabs}
          value={category}
          onChange={setCategory}
          variant="pill"
          aria-label="Template category"
        />
        <div className="relative ml-auto w-64">
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates"
            aria-label="Search templates"
            className="pl-8"
          />
        </div>
      </div>

      {!screen && (
        <p className="rounded-md border border-status-warn/40 bg-status-warn/10 p-3 text-sm text-status-warn">
          There is no screen to place onto. Generate one from the workspace first.
        </p>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((template) => {
          const preview = previewScreen(template);
          const view = preview.Children[0];
          return (
            <li
              key={template.id}
              className="flex flex-col rounded-panel border border-line-subtle bg-surface-raised"
            >
              {/* The preview is the real renderer over the real parts, so it
                  cannot show something the template will not place. */}
              <div
                className="flex h-40 items-center justify-center overflow-hidden rounded-t-panel border-b border-line-subtle bg-surface-base p-3"
                aria-hidden
              >
                <div
                  className="max-h-full"
                  style={{ aspectRatio: `${view.Width} / ${view.Height}`, width: "100%" }}
                >
                  <ScreenRenderer
                    screen={preview}
                    selectedIds={[]}
                    interactive={false}
                  />
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {template.name}
                  </p>
                  <Badge tone="neutral">{template.category}</Badge>
                </div>
                <p className="text-xs text-text-muted">{template.description}</p>
                <p className="text-[11px] text-text-faint">
                  {template.build({ left: 0, top: 0 }, 1).length} objects ·{" "}
                  {template.size.width} × {template.size.height}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  block
                  className={cn("mt-auto")}
                  disabled={!screen}
                  onClick={() => use(template)}
                  icon={<Plus size={14} />}
                >
                  Use template
                </Button>
              </div>
            </li>
          );
        })}

        {shown.length === 0 && (
          <li className="col-span-full rounded-panel border border-dashed border-line p-10 text-center text-sm text-text-muted">
            No template matches that search.
          </li>
        )}
      </ul>
    </div>
  );
}
