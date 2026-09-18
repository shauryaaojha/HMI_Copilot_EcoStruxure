"use client";

/**
 * The props of a composite, as one form.
 *
 * The selection is the six parts an indicator expanded to; what the engineer
 * wants to change is the indicator's range, its label, its tag. The fields
 * come from the composite's own zod schema through the same walker the part
 * inspector uses, so a prop added to a definition gets an editor for free.
 * Every change re-expands the composite in place, as one undo step.
 */

import { Layers, Ungroup } from "lucide-react";
import { COMPOSITES, type CompositeKind } from "@/lib/composites";
import { ACCEPTS } from "@/lib/validation/rules";
import type { CompositeInstance } from "@/store/types";
import { useProject } from "@/store/project";
import { Button, Field, Panel, Select } from "@/components/ui";
import { FieldEditor } from "./editors";
import { fieldsOfSchema } from "./schemaFields";

/** "normalLow" -> "Normal low". */
function label(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Props that name a tag get the tag picker, not a text box. */
const TAG_PROPS: Record<string, readonly string[]> = {
  tag: ["INT", "DINT", "UINT", "UDINT", "WORD", "DWORD", "REAL", "LREAL"],
  runTag: ["BOOL"],
  faultTag: ["BOOL"],
};

export function CompositeEditor({ instance }: { instance: CompositeInstance }) {
  const variables = useProject((s) => s.variables);
  const setCompositeProps = useProject((s) => s.setCompositeProps);
  const ungroup = useProject((s) => s.ungroup);
  const removeObjects = useProject((s) => s.removeObjects);
  const def = COMPOSITES[instance.kind as CompositeKind];
  if (!def) return null;

  const fields = fieldsOfSchema(def.props).filter((f) => f.key !== "graphic");
  void ACCEPTS;

  return (
    <>
      <div className="flex items-center gap-1 px-3 py-2.5">
        <Layers size={15} aria-hidden className="shrink-0 text-brand-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{def.label}</p>
          <p className="truncate font-mono text-[11px] text-text-muted">
            #{instance.name} · {instance.partIds.length} parts
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Ungroup into parts"
          title="Ungroup into its parts. They stay; the composite does not."
          onClick={() => ungroup(instance.partIds)}
          icon={<Ungroup size={15} />}
        />
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Delete composite"
          title="Delete the composite and every part of it"
          onClick={() => removeObjects(instance.partIds)}
          icon={<span aria-hidden className="text-base leading-none">×</span>}
        />
      </div>

      <p className="px-3 pb-2 text-[11px] leading-snug text-text-faint">{def.hint}. Changing anything here rebuilds it in place.</p>

      <Panel title="Properties">
        <div className="space-y-2">
          {fields.map((field) => {
            const value = instance.props[field.key];
            const tagTypes = TAG_PROPS[field.key];
            if (tagTypes) {
              const eligible = variables.filter((v) => tagTypes.includes(v.DataType));
              return (
                <Field key={field.key} label={label(field.key)}>
                  <Select
                    aria-label={label(field.key)}
                    size="sm"
                    value={(value as string | undefined) ?? ""}
                    options={[
                      { value: "", label: "Unbound" },
                      ...eligible.map((v) => ({ value: v.Name, label: v.Comments ? `${v.Name} — ${v.Comments}` : v.Name })),
                    ]}
                    onChange={(e) => setCompositeProps(instance.id, { [field.key]: e.target.value || undefined })}
                  />
                </Field>
              );
            }
            return (
              <Field key={field.key} label={label(field.key)}>
                <FieldEditor
                  field={field}
                  value={value}
                  onChange={(path, next) => setCompositeProps(instance.id, { [path[0]]: next })}
                />
              </Field>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
