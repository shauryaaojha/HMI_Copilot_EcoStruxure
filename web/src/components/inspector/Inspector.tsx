"use client";

/**
 * The right pane: properties, tags and the object library.
 * Reference screens 1, 2, 5, 6. Phase 5 of docs/BUILD_PLAN.md.
 *
 * The property groups are generated from the Phase 1 zod schemas rather than
 * hand-written per part type - see schemaFields.ts. A part gains an editor the
 * moment it gains a schema, and a field FORMAT adds to schema.ts turns up here
 * on the next reload with a control that already writes back correctly.
 *
 * Edits go through useProject.setProperty, which writes into the same tree the
 * packager serialises, so the canvas re-renders from the edit immediately and
 * the export carries it.
 */

import { useState } from "react";
import { Lock, Trash2, Unlock } from "lucide-react";
import { useProject } from "@/store/project";
import { TagTable } from "@/components/tags";
import { LibraryPanel } from "@/components/library/LibraryPanel";
import { Badge, Button, Field, Input, Panel, Tabs, type TabItem } from "@/components/ui";
import { FieldEditor } from "./editors";
import { LayersPanel } from "./LayersPanel";
import { groupsOf, valueAt, type SchemaField } from "./schemaFields";

type InspectorTab = "properties" | "layers" | "library" | "tags";

/** "TextColor" -> "Text colour" is a step too far; "DecimalDigits" -> "Decimal digits". */
function label(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0) + spaced.slice(1).toLowerCase();
}

function FieldRow({
  field,
  part,
  onChange,
}: {
  field: SchemaField;
  part: unknown;
  onChange: (path: string[], value: unknown) => void;
}) {
  // A nested group - a Lamp's Off and On states - becomes its own subsection,
  // because a state is a set of properties rather than a single value.
  if (field.kind === "group" && field.fields) {
    return (
      <div className="rounded-md border border-line-subtle p-2">
        <p className="mb-2 text-xs font-medium text-text-secondary">
          {label(field.key)}
        </p>
        <div className="space-y-2">
          {field.fields.map((child) => (
            <FieldRow
              key={child.path.join(".")}
              field={child}
              part={part}
              onChange={onChange}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <Field label={label(field.key)}>
      <FieldEditor
        field={field}
        value={valueAt(part, field.path)}
        onChange={onChange}
      />
    </Field>
  );
}

export function Inspector() {
  const [tab, setTab] = useState<InspectorTab>("properties");
  const screens = useProject((s) => s.screens);
  const variables = useProject((s) => s.variables);
  const bindings = useProject((s) => s.bindings);
  const findings = useProject((s) => s.findings);
  const selectedIds = useProject((s) => s.selectedIds);
  const objectMeta = useProject((s) => s.objectMeta);
  const setProperty = useProject((s) => s.setProperty);
  const removeObjects = useProject((s) => s.removeObjects);
  const setBox = useProject((s) => s.setBox);
  const setMeta = useProject((s) => s.setMeta);

  // The inspector edits one object; a marquee selection of several reports the
  // count instead, because a property panel over a heterogeneous selection is a
  // way to change something you cannot see.
  const only = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const part = screens
    .flatMap((s) => s.Children[0].Children)
    .find((p) => p.UniqueId === only);

  const bound = bindings.filter((b) => b.targetId === only);
  const flagged = findings.filter((f) => f.objectId === only);

  const objectCount = screens.reduce(
    (n, screen) => n + screen.Children[0].Children.length,
    0,
  );

  const tabs: TabItem<InspectorTab>[] = [
    { id: "properties", label: "Properties" },
    { id: "layers", label: "Layers", count: objectCount },
    { id: "library", label: "Library" },
    { id: "tags", label: "Tags", count: variables.length },
  ];

  const locked = only ? !!objectMeta[only]?.locked : false;

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-end border-b border-line-subtle px-2">
        <Tabs items={tabs} value={tab} onChange={setTab} aria-label="Inspector" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "tags" ? (
          <TagTable
            variables={variables}
            compact
            highlight={bound.map((b) => b.tag)}
            className="h-full p-3"
          />
        ) : tab === "library" ? (
          <LibraryPanel />
        ) : tab === "layers" ? (
          <LayersPanel />
        ) : selectedIds.length > 1 ? (
          <p className="p-4 text-sm text-text-muted">
            {selectedIds.length} objects selected. The toolbar aligns and
            distributes them; arrow keys nudge, shift-arrow moves by the grid.
          </p>
        ) : !part ? (
          <p className="p-4 text-sm text-text-muted">
            Select an object on the canvas to inspect its properties and bindings.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{part.Type}</p>
                <p className="truncate font-mono text-[11px] text-text-muted">
                  #{part.Name}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                className="ml-auto"
                aria-pressed={locked}
                aria-label={locked ? "Unlock object" : "Lock object"}
                title={locked ? "Unlock object" : "Lock object"}
                onClick={() => setMeta([part.UniqueId], { locked: !locked })}
                icon={locked ? <Lock size={15} /> : <Unlock size={15} />}
              />
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label="Delete object"
                title="Delete object"
                onClick={() => removeObjects([part.UniqueId])}
                icon={<Trash2 size={15} />}
              />
            </div>

            {/* Geometry first: it is what an engineer reaches for most, and
                typing 320 is more precise than dragging to it. */}
            <Panel title="Geometry">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["X", part.Location.Left, "left"],
                    ["Y", part.Location.Top, "top"],
                    ["W", part.Width, "width"],
                    ["H", part.Height, "height"],
                  ] as const
                ).map(([axis, value, key]) => (
                  <Field key={key} label={axis}>
                    <Input
                      type="number"
                      value={value}
                      disabled={locked}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        setBox(part.UniqueId, {
                          left: part.Location.Left,
                          top: part.Location.Top,
                          width: part.Width,
                          height: part.Height,
                          [key]: key === "width" || key === "height"
                            ? Math.max(1, next)
                            : next,
                        });
                      }}
                    />
                  </Field>
                ))}
              </div>
            </Panel>

            {flagged.length > 0 && (
              <ul className="mx-3 mb-2 space-y-1">
                {flagged.map((finding, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-status-warn/40 bg-status-warn/10 p-2 text-[11px] text-status-warn"
                  >
                    {finding.message}
                  </li>
                ))}
              </ul>
            )}

            <Panel title="Data binding" collapsible>
              {bound.length === 0 ? (
                <Badge tone="warn" dot>
                  Unbound
                </Badge>
              ) : (
                <ul className="space-y-2">
                  {bound.map((b) => (
                    <li
                      key={`${b.tag}-${b.property}`}
                      className="rounded-md border border-line-subtle p-2"
                    >
                      <p className="font-mono text-xs text-brand-400">{b.tag}</p>
                      <p className="text-[11px] text-text-muted">
                        drives {b.property}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {groupsOf(part.Type).map((group) => (
              <Panel key={group.title} title={group.title} collapsible>
                <div className="space-y-2">
                  {group.fields.map((field) => (
                    <FieldRow
                      key={field.path.join(".")}
                      field={field}
                      part={part}
                      onChange={(path, value) => setProperty(part.UniqueId, path, value)}
                    />
                  ))}
                </div>
              </Panel>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
