"use client";

/**
 * The right pane: properties, bindings and the object library.
 * Reference screens 1, 2, 5, 6. Phase 5 of docs/BUILD_PLAN.md.
 *
 * Phase 5 generates the property groups from the Phase 1 zod schemas rather
 * than hand-writing them per part type, so a part gains an editor the moment it
 * gains a schema. What is here now is the frame and the identity block.
 */

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useProject } from "@/store/project";
import { Badge, Button, Field, Input, Panel, Tabs, type TabItem } from "@/components/ui";

type InspectorTab = "properties" | "tags" | "library";

export function Inspector() {
  const [tab, setTab] = useState<InspectorTab>("properties");
  const screens = useProject((s) => s.screens);
  const variables = useProject((s) => s.variables);
  const bindings = useProject((s) => s.bindings);
  const selectedIds = useProject((s) => s.selectedIds);

  // The inspector edits one object; a marquee selection of several reports the
  // count instead, because a property panel over a heterogeneous selection is a
  // way to change something you cannot see.
  const only = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const part = screens
    .flatMap((s) => s.Children[0].Children)
    .find((p) => p.UniqueId === only);

  const bound = bindings.filter((b) => b.targetId === only);

  const tabs: TabItem<InspectorTab>[] = [
    { id: "properties", label: "Properties" },
    { id: "tags", label: "Tags", count: variables.length },
    { id: "library", label: "Library" },
  ];

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-end border-b border-line-subtle px-2">
        <Tabs items={tabs} value={tab} onChange={setTab} aria-label="Inspector" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab !== "properties" ? (
          <p className="p-4 text-sm text-text-muted">
            {tab === "tags"
              ? "The tag table arrives with Phase 3."
              : "The graphic object library arrives with Phase 2b."}
          </p>
        ) : selectedIds.length > 1 ? (
          <p className="p-4 text-sm text-text-muted">
            {selectedIds.length} objects selected. Arrow keys nudge them; shift-arrow
            moves by the grid.
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
                aria-label="Delete object"
                title="Delete object"
                icon={<Trash2 size={15} />}
              />
            </div>

            <Panel title="General" collapsible>
              <div className="space-y-2">
                <Field label="Name">
                  <Input value={part.Name} readOnly mono />
                </Field>
                <Field label="Type">
                  <Input value={part.Type} readOnly mono />
                </Field>
                <Field label="Position">
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={`X ${part.Location.Left}`} readOnly mono />
                    <Input value={`Y ${part.Location.Top}`} readOnly mono />
                  </div>
                </Field>
                <Field label="Size">
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={`W ${part.Width}`} readOnly mono />
                    <Input value={`H ${part.Height}`} readOnly mono />
                  </div>
                </Field>
              </div>
            </Panel>

            <Panel title="Data binding" collapsible>
              {bound.length === 0 ? (
                <Badge tone="warn" dot>
                  Unbound
                </Badge>
              ) : (
                <ul className="space-y-2">
                  {bound.map((b) => (
                    <li key={`${b.tag}-${b.property}`} className="space-y-1">
                      <Field label="Source tag">
                        <Input value={b.tag} readOnly mono />
                      </Field>
                      <Field label="Property">
                        <Input value={b.property} readOnly mono />
                      </Field>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
      </div>
    </aside>
  );
}
