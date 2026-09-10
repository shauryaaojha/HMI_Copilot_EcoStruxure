"use client";

/**
 * Settings - reference screen 11, and the design-system reference from screen 12.
 *
 * Only settings that do something are offered. A toggle for a preference
 * nothing reads is worse than no toggle: it teaches the engineer that controls
 * in this product might be decorative.
 *
 * Phase 9 of docs/BUILD_PLAN.md.
 */

import { useState } from "react";
import { useProject } from "@/store/project";
import { useTheme } from "@/components/shell/theme";
import {
  Badge,
  Button,
  Field,
  Input,
  Panel,
  Select,
  Tabs,
  Toggle,
  type TabItem,
} from "@/components/ui";

type Tab = "general" | "appearance" | "components";

const TABS: TabItem<Tab>[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "components", label: "Components" },
];

const SHORTCUTS: [string, string][] = [
  ["Click / Shift-click", "Select an object, or add it to the selection"],
  ["Drag on empty canvas", "Marquee select"],
  ["Drag an object", "Move it, snapped to the grid"],
  ["Arrow keys", "Nudge by one unit"],
  ["Shift + arrows", "Nudge by the grid size"],
  ["Delete / Backspace", "Remove the selected objects"],
  ["Escape", "Clear the selection"],
  ["Ctrl / ⌘ + wheel", "Zoom the canvas"],
  ["Middle-drag", "Pan the canvas"],
];

export function SettingsScreen() {
  const [tab, setTab] = useState<Tab>("general");
  const { theme, setTheme } = useTheme();
  const standards = useProject((s) => s.standards);
  const setStandards = useProject((s) => s.setStandards);
  const reset = useProject((s) => s.reset);

  return (
    <div className="space-y-5">
      <Tabs items={TABS} value={tab} onChange={setTab} aria-label="Settings" />

      {tab === "general" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Editing" bordered>
            <div className="space-y-3">
              <Field label="Grid size">
                <Select
                  aria-label="Grid size"
                  value={String(standards.gridSize)}
                  options={[4, 8, 10, 16, 20].map((n) => ({
                    value: String(n),
                    label: `${n} px`,
                  }))}
                  onChange={(e) => setStandards({ gridSize: Number(e.target.value) })}
                />
              </Field>
              <Toggle
                checked={standards.snap}
                onChange={(on) => setStandards({ snap: on })}
                label="Snap to grid"
              />
              <Toggle
                checked={standards.showGrid}
                onChange={(on) => setStandards({ showGrid: on })}
                label="Show the grid by default"
              />
              <p className="text-xs text-text-faint">
                These are company standards and live on the Standards screen too;
                both write the same values.
              </p>
            </div>
          </Panel>

          <Panel title="Keyboard" bordered>
            <dl className="space-y-1.5">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-baseline gap-3">
                  <dt className="w-44 shrink-0 font-mono text-[11px] text-text-secondary">
                    {keys}
                  </dt>
                  <dd className="text-xs text-text-muted">{what}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="This session" bordered>
            <div className="space-y-3">
              <p className="text-xs text-text-muted">
                The project lives in this browser tab. Nothing is uploaded; the only
                way out is the Export screen, which writes an .eote.
              </p>
              <Button variant="danger" size="sm" onClick={() => reset()}>
                Clear the project
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {tab === "appearance" && (
        <Panel title="Theme" bordered className="max-w-2xl">
          <div className="space-y-3">
            <Field label="Chrome">
              <Select
                aria-label="Theme"
                value={theme}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
                onChange={(e) => setTheme(e.target.value as "dark" | "light")}
              />
            </Field>
            <p className="text-xs text-text-muted">
              This themes the application only. The HMI screen on the canvas is never
              themed by us — its colours are palette indices resolved out of the
              project&apos;s own colour set, so flipping this leaves the screen
              exactly as it will look in the product. That is what makes the preview
              trustworthy.
            </p>
          </div>
        </Panel>
      )}

      {tab === "components" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Buttons" bordered>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm">Small</Button>
                <Button size="md">Default</Button>
                <Button size="lg">Large</Button>
                <Button disabled>Disabled</Button>
              </div>
            </div>
          </Panel>

          <Panel title="Badges" bordered>
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">neutral</Badge>
              <Badge tone="brand">brand</Badge>
              <Badge tone="ok" dot>ok</Badge>
              <Badge tone="warn" dot>warning</Badge>
              <Badge tone="alarm" dot>alarm</Badge>
              <Badge tone="info">info</Badge>
            </div>
          </Panel>

          <Panel title="Inputs" bordered>
            <div className="space-y-3">
              <Field label="Text">
                <Input defaultValue="Pump_Station_Demo" />
              </Field>
              <Field label="Select">
                <Select
                  aria-label="Example"
                  options={[
                    { value: "a", label: "Option A" },
                    { value: "b", label: "Option B" },
                  ]}
                />
              </Field>
              <Field label="Toggle">
                <Toggle checked onChange={() => {}} label="On" />
              </Field>
            </div>
          </Panel>

          <Panel title="Where these live" bordered>
            <p className="text-xs text-text-muted">
              Every control above is the same component the workspace uses, from
              src/components/ui. This tab is the reference screen 12 design system,
              rendered from the primitives rather than drawn as a picture of them.
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}
