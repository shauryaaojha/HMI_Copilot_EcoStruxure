"use client";

/**
 * The centre pane: view tabs, zoom controls and the screen itself.
 * Reference screens 1, 2, 5, 6. Phase 2 of docs/BUILD_PLAN.md.
 */

import { useState } from "react";
import { useProject } from "@/store/project";
import { demoLiveValues, demoScreen } from "@/fixtures";
import { ScreenRenderer } from "./ScreenRenderer";

const TABS = ["Design", "Binding Map", "Script", "Preview (SVG)", "JSON"] as const;

export function CanvasPane() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Design");
  const [zoom, setZoom] = useState(100);
  const { screens, activeScreenId, selectedObjectId, select, values, simulating } =
    useProject();

  // Until the generation pipeline lands, fall back to the fixture lifted out of
  // demo_project/HMICopilot_PumpStation.eote, so the canvas can be built and
  // judged against a real project on a machine with no EcoStruxure install.
  const screen =
    screens.find((s) => s.UniqueId === activeScreenId) ?? screens[0] ?? demoScreen;

  return (
    <section className="flex min-w-0 flex-1 flex-col border-x border-chrome-800">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-chrome-800 px-3">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              tab === t
                ? "border-b-2 border-brand-400 text-brand-400"
                : "text-ink-500 hover:text-ink-300"
            }`}
          >
            {t}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 text-sm text-ink-300">
          <button type="button" onClick={() => setZoom((z) => Math.max(25, z - 25))}>
            −
          </button>
          <span className="w-12 text-center tabular-nums">{zoom}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(400, z + 25))}>
            +
          </button>
        </div>
      </div>

      <div className="canvas-grid flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        {screen ? (
          <div
            className="shadow-2xl"
            style={{
              width: screen.Children[0].Width * (zoom / 100),
              height: screen.Children[0].Height * (zoom / 100),
            }}
          >
            <ScreenRenderer
              screen={screen}
              selectedId={selectedObjectId}
              onSelect={select}
              values={simulating ? { ...demoLiveValues, ...values } : undefined}
            />
          </div>
        ) : (
          <p className="max-w-sm text-center text-sm text-ink-500">
            No screen yet. Describe what you need on the left, or import a PLC tag
            export, and the screen will assemble here object by object.
          </p>
        )}
      </div>
    </section>
  );
}
