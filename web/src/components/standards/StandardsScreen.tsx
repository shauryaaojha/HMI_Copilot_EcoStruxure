"use client";

/**
 * Engineering Standards - reference screen 5.
 *
 * These are not preferences. The grid the canvas draws and snaps to comes from
 * here, and the colour set is the one every part on every screen resolves its
 * palette indices through - change it and the screens change, because a screen
 * colour in an EcoStruxure project is an index, not an RGB value.
 *
 * That is also why the colour panel is read-only about the palette itself: the
 * sixty colours are the product's, from Buildtime/CommonScripts/Colors, and
 * inventing a sixty-first would produce a project OTE cannot open.
 *
 * Phase 9 of docs/BUILD_PLAN.md.
 */

import { useState } from "react";
import { COLOR_SETS, resolveColor } from "@/lib/ote/palette";
import { useProject } from "@/store/project";
import { Badge, Field, Panel, Select, Toggle, Tabs, type TabItem } from "@/components/ui";

type Tab = "general" | "colours" | "naming" | "layout";

const TABS: TabItem<Tab>[] = [
  { id: "general", label: "General" },
  { id: "colours", label: "Colours" },
  { id: "naming", label: "Naming" },
  { id: "layout", label: "Layout" },
];

/** The indices lib/ote/parts.ts names, so the swatches mean something. */
const ROLES: [string, number][] = [
  ["Ink", 1],
  ["Paper", 2],
  ["Green", 3],
  ["Amber", 4],
  ["Red", 5],
  ["Grey", 11],
  ["White", 21],
  ["Dark grey", 22],
  ["Black", 31],
  ["Dark green", 43],
];

const GRID_SIZES = [4, 8, 10, 16, 20].map((n) => ({
  value: String(n),
  label: `${n} px`,
}));

export function StandardsScreen() {
  const [tab, setTab] = useState<Tab>("general");
  const standards = useProject((s) => s.standards);
  const setStandards = useProject((s) => s.setStandards);
  const target = useProject((s) => s.target);

  const set = COLOR_SETS[standards.colorSet as keyof typeof COLOR_SETS] ?? COLOR_SETS[4];

  return (
    <div className="space-y-5">
      <Tabs items={TABS} value={tab} onChange={setTab} aria-label="Standards" />

      {tab === "general" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Screen defaults" bordered>
            <div className="space-y-3">
              <Field label="Resolution" layout="stack">
                <p className="text-sm text-text-secondary">
                  {target.model} · {target.width} × {target.height}
                </p>
                <p className="mt-1 text-xs text-text-faint">
                  Set from the target panel in the top bar; a screen larger than the
                  panel is an error at validation, not a warning.
                </p>
              </Field>
            </div>
          </Panel>

          <Panel title="Colour set" bordered>
            <div className="space-y-2">
              <p className="text-sm">
                {set.name}{" "}
                <Badge tone="neutral">ColorSet {standards.colorSet}</Badge>
              </p>
              <p className="text-xs text-text-muted">
                Read from the product&apos;s own
                Buildtime/CommonScripts/Colors/Colors.lua. Every colour on every
                screen is an index into this set.
              </p>
            </div>
          </Panel>
        </div>
      )}

      {tab === "colours" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Named roles" bordered>
            <ul className="grid grid-cols-2 gap-2">
              {ROLES.map(([role, index]) => (
                <li key={role} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-6 w-6 shrink-0 rounded-sm border border-line-strong"
                    style={{ background: resolveColor(index) }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{role}</span>
                    <span className="block font-mono text-[10px] text-text-muted">
                      {index} · {resolveColor(index)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={`${set.name} — all 60`} bordered>
            <div className="grid grid-cols-10 gap-1">
              {set.colors.map((_, i) => (
                <span
                  key={i}
                  title={`${i + 1} · ${resolveColor(i + 1)}`}
                  className="aspect-square rounded-sm border border-line-strong"
                  style={{ background: resolveColor(i + 1) }}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-text-muted">
              The palette is the product&apos;s and is fixed. A colour outside it
              cannot be written into a project OTE will open.
            </p>
          </Panel>
        </div>
      )}

      {tab === "naming" && (
        <Panel title="Naming conventions" bordered className="max-w-2xl">
          <div className="space-y-3">
            <Toggle
              checked={standards.enforceNaming}
              onChange={(on) => setStandards({ enforceNaming: on })}
              label="Correct tag names on import"
            />
            <p className="text-xs text-text-muted">
              Names are checked against what OTE accepts: letters, digits and
              underscore, never leading with a digit, never a reserved word. A name
              that fails is corrected and the correction is <em>reported</em> on the
              Tags screen — never applied silently.
            </p>
            <ul className="space-y-1 font-mono text-xs text-text-secondary">
              <li>
                <span className="text-text-faint line-through">2ND PUMP RUN</span> →
                Tag_2ND_PUMP_RUN
              </li>
              <li>
                <span className="text-text-faint line-through">MOTOR-SPEED</span> →
                MOTOR_SPEED
              </li>
            </ul>
          </div>
        </Panel>
      )}

      {tab === "layout" && (
        <Panel title="Grid and snapping" bordered className="max-w-2xl">
          <div className="space-y-3">
            <Field label="Grid size">
              <Select
                aria-label="Grid size"
                value={String(standards.gridSize)}
                options={GRID_SIZES}
                onChange={(e) => setStandards({ gridSize: Number(e.target.value) })}
              />
            </Field>
            <Toggle
              checked={standards.showGrid}
              onChange={(on) => setStandards({ showGrid: on })}
              label="Show the grid by default"
            />
            <Toggle
              checked={standards.snap}
              onChange={(on) => setStandards({ snap: on })}
              label="Snap to grid"
            />
            <p className="text-xs text-text-muted">
              These drive the canvas directly: the grid it draws, what dragging snaps
              to, and how far shift-arrow nudges an object.
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}
