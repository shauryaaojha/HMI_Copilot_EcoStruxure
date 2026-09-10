"use client";

/**
 * One editor per FieldKind. These are chosen by what schemaFields.ts found in
 * the zod schema, never by the property's name, so a new schema field lands
 * with a working control rather than a "not implemented" row.
 *
 * Phase 5 of docs/BUILD_PLAN.md.
 */

import { COLOR_SETS, DEFAULT_COLOR_SET, resolveColor } from "@/lib/ote/palette";
import { Input, Select, Toggle, cn } from "@/components/ui";
import type { SchemaField } from "./schemaFields";

export interface EditorProps {
  field: SchemaField;
  value: unknown;
  onChange: (path: string[], value: unknown) => void;
}

/* ---------------------------------------------------------------------- */
/* Colour: a palette index, not an RGB value                               */
/* ---------------------------------------------------------------------- */

const PALETTE = COLOR_SETS[DEFAULT_COLOR_SET];

/**
 * A screen colour in an EcoStruxure project is an index into the project's
 * colour set. Offering a hex picker would let the engineer choose something the
 * file cannot hold, so the editor is the palette itself.
 */
export function ColorEditor({ field, value, onChange }: EditorProps) {
  const index = (value as { Color?: { Value?: number } } | undefined)?.Color?.Value;

  return (
    <details className="group">
      <summary className="focus-ring flex h-8 cursor-pointer list-none items-center gap-2 rounded-md border border-line bg-surface-raised px-2">
        <span
          aria-hidden
          className="h-4 w-4 shrink-0 rounded-sm border border-line-strong"
          style={{ background: resolveColor(index, "transparent") }}
        />
        <span className="font-mono text-xs text-text-secondary">
          {index === undefined ? "unset" : `${index} · ${resolveColor(index)}`}
        </span>
      </summary>

      <div className="mt-1.5 rounded-md border border-line bg-surface-raised p-2">
        <p className="mb-1.5 text-[11px] text-text-faint">
          {PALETTE.name} — the project&apos;s own colour set
        </p>
        <div className="grid grid-cols-10 gap-1">
          {PALETTE.colors.map((_, i) => {
            const at = i + 1;
            return (
              <button
                key={at}
                type="button"
                title={`${at} · ${resolveColor(at)}`}
                aria-label={`Palette colour ${at}`}
                onClick={() => onChange(field.path, { Color: { Value: at } })}
                className={cn(
                  "focus-ring h-5 w-full rounded-sm border transition",
                  at === index
                    ? "border-brand-400 ring-1 ring-brand-400"
                    : "border-line-strong hover:border-text-muted",
                )}
                style={{ background: resolveColor(at) }}
              />
            );
          })}
        </div>
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------------- */
/* Alignment: the product's own flag values                                */
/* ---------------------------------------------------------------------- */

const HORIZONTAL = [
  { value: "1", label: "Left" },
  { value: "2", label: "Centre" },
  { value: "4", label: "Right" },
];
const VERTICAL = [
  { value: "1", label: "Top" },
  { value: "64", label: "Middle" },
  { value: "4", label: "Bottom" },
];

export function AlignEditor({ field, value, onChange }: EditorProps) {
  const layout = (value ?? {}) as {
    HorizontalAlignment?: number;
    VerticalAlignment?: number;
    Wrap?: boolean;
  };

  const set = (key: string, next: unknown) =>
    onChange(field.path, { ...layout, [key]: next });

  return (
    <div className="space-y-1.5">
      <Select
        aria-label="Horizontal alignment"
        size="sm"
        value={String(layout.HorizontalAlignment ?? 1)}
        options={HORIZONTAL}
        onChange={(e) => set("HorizontalAlignment", Number(e.target.value))}
      />
      <Select
        aria-label="Vertical alignment"
        size="sm"
        value={String(layout.VerticalAlignment ?? 64)}
        options={VERTICAL}
        onChange={(e) => set("VerticalAlignment", Number(e.target.value))}
      />
      <Toggle
        size="sm"
        label="Wrap"
        checked={Boolean(layout.Wrap)}
        onChange={(next) => set("Wrap", next)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Location and font                                                       */
/* ---------------------------------------------------------------------- */

export function LocationEditor({ field, value, onChange }: EditorProps) {
  const at = (value ?? { Left: 0, Top: 0 }) as { Left: number; Top: number };
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["Left", "Top"] as const).map((axis) => (
        <Input
          key={axis}
          type="number"
          mono
          aria-label={axis}
          value={at[axis] ?? 0}
          onChange={(e) => onChange(field.path, { ...at, [axis]: Number(e.target.value) })}
        />
      ))}
    </div>
  );
}

export function FontEditor({ field, value, onChange }: EditorProps) {
  const font = (value ?? {}) as { Size?: number; Bold?: boolean; Italic?: boolean };
  const set = (key: string, next: unknown) => onChange(field.path, { ...font, [key]: next });

  return (
    <div className="space-y-1.5">
      <Input
        type="number"
        mono
        min={1}
        aria-label="Font size"
        value={font.Size ?? 12}
        onChange={(e) => set("Size", Number(e.target.value))}
      />
      <div className="flex gap-3">
        <Toggle size="sm" label="Bold" checked={Boolean(font.Bold)} onChange={(n) => set("Bold", n)} />
        <Toggle size="sm" label="Italic" checked={Boolean(font.Italic)} onChange={(n) => set("Italic", n)} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* The dispatcher                                                          */
/* ---------------------------------------------------------------------- */

export function FieldEditor({ field, value, onChange }: EditorProps) {
  if (field.readOnly) {
    return <Input mono readOnly value={value === undefined ? "—" : String(value)} />;
  }

  switch (field.kind) {
    case "text":
      return (
        <Input
          value={(value as string) ?? ""}
          aria-label={field.key}
          onChange={(e) => onChange(field.path, e.target.value)}
        />
      );

    case "number":
    case "integer":
      return (
        <Input
          type="number"
          mono
          aria-label={field.key}
          min={field.min}
          max={field.max}
          step={field.kind === "integer" ? 1 : "any"}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const next = e.target.value === "" ? undefined : Number(e.target.value);
            onChange(field.path, next);
          }}
        />
      );

    case "boolean":
      return (
        <Toggle
          size="sm"
          label={field.key}
          labelHidden
          checked={Boolean(value)}
          onChange={(next) => onChange(field.path, next)}
        />
      );

    case "enum":
      return (
        <Select
          aria-label={field.key}
          size="sm"
          value={(value as string) ?? field.options?.[0] ?? ""}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          onChange={(e) => onChange(field.path, e.target.value)}
        />
      );

    case "color":
      return <ColorEditor field={field} value={value} onChange={onChange} />;

    case "align":
      return <AlignEditor field={field} value={value} onChange={onChange} />;

    case "location":
      return <LocationEditor field={field} value={value} onChange={onChange} />;

    case "font":
      return <FontEditor field={field} value={value} onChange={onChange} />;

    default:
      // A shape the classifier did not recognise is shown rather than hidden,
      // so an unhandled schema addition is visible instead of silently missing.
      return (
        <Input
          mono
          readOnly
          value={value === undefined ? "—" : JSON.stringify(value)}
          title="No editor for this shape yet"
        />
      );
  }
}
