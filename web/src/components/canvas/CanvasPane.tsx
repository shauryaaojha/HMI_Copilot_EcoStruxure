"use client";

/**
 * The centre pane: view tabs, zoom controls and the screen itself.
 * Reference screens 1, 2, 5, 6. Phase 2 of docs/BUILD_PLAN.md.
 *
 * Phase 0 gave it its frame. Selection handles, marquee, pan, fit, grid and
 * snap are Phase 2, and the target for that work is assets/screen_design.png -
 * the same JSON rendered by tools/render_screen.py.
 */

import { useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useProject } from "@/store/project";
import { demoLiveValues, demoScreen } from "@/fixtures";
import { Button, Tabs, type TabItem } from "@/components/ui";
import { ScreenRenderer } from "./ScreenRenderer";

type CanvasTab = "design" | "bindings" | "script" | "preview" | "json";

const TABS: TabItem<CanvasTab>[] = [
  { id: "design", label: "Design" },
  { id: "bindings", label: "Binding Map" },
  { id: "script", label: "Script" },
  { id: "preview", label: "Preview (SVG)" },
  { id: "json", label: "JSON" },
];

const ZOOMS = [25, 50, 75, 100, 150, 200, 400];

export function CanvasPane() {
  const [tab, setTab] = useState<CanvasTab>("design");
  const [zoom, setZoom] = useState(100);
  const screens = useProject((s) => s.screens);
  const activeScreenId = useProject((s) => s.activeScreenId);
  const selectedObjectId = useProject((s) => s.selectedObjectId);
  const select = useProject((s) => s.select);
  const values = useProject((s) => s.values);
  const simulating = useProject((s) => s.simulating);

  // Until the generation pipeline lands, fall back to the fixture lifted out of
  // demo_project/HMICopilot_PumpStation.eote, so the canvas can be built and
  // judged against a real project on a machine with no EcoStruxure install.
  const screen =
    screens.find((s) => s.UniqueId === activeScreenId) ?? screens[0] ?? demoScreen;
  const view = screen.Children[0];

  const step = (direction: 1 | -1) =>
    setZoom((current) => {
      const next = ZOOMS.filter((z) => (direction === 1 ? z > current : z < current));
      return direction === 1
        ? (next[0] ?? current)
        : (next[next.length - 1] ?? current);
    });

  return (
    <section className="flex h-full w-full min-w-0 flex-col">
      <div className="flex h-12 shrink-0 items-end gap-2 border-b border-line-subtle px-2">
        <Tabs items={TABS} value={tab} onChange={setTab} aria-label="Canvas view" />

        <div className="ml-auto flex items-center gap-1 pb-1.5">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => step(-1)}
            aria-label="Zoom out"
            icon={<Minus size={15} />}
          />
          <span className="w-12 text-center text-xs tabular-nums text-text-secondary">
            {zoom}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => step(1)}
            aria-label="Zoom in"
            icon={<Plus size={15} />}
          />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => setZoom(100)}
            aria-label="Reset zoom to 100%"
            title="Reset zoom"
            icon={<Maximize2 size={14} />}
          />
        </div>
      </div>

      <div className="canvas-grid flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        {tab !== "design" ? (
          <p className="max-w-sm text-center text-sm text-text-muted">
            {TABS.find((t) => t.id === tab)?.label} arrives with a later phase — see
            docs/BUILD_PLAN.md.
          </p>
        ) : (
          <div
            className="canvas-screen shrink-0"
            style={{
              width: view.Width * (zoom / 100),
              height: view.Height * (zoom / 100),
            }}
          >
            <ScreenRenderer
              screen={screen}
              selectedId={selectedObjectId}
              onSelect={select}
              values={simulating ? { ...demoLiveValues, ...values } : undefined}
            />
          </div>
        )}
      </div>
    </section>
  );
}
