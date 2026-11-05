import { createHash } from "node:crypto";
import { PANELS } from "@/lib/backend/panels";
import { OTE } from "@/lib/backend/ote";
import { MACHINE_CLASSES } from "@/lib/library/machines";
import { PART_TYPES, type Part } from "@/lib/ote/schema";
import { partDefaultSize } from "@/lib/ote/default-size";
import { gridFor, capacityOf, ZONES } from "@/lib/ote/layout";
import { fieldsOf, groupsOf, type SchemaField } from "@/components/inspector/schemaFields";
import { acceptedTypes, valuePropertyOf } from "@/lib/tags/binder";
import type { Entry, PanelBody, PartTypeBody, PatternBody } from "../types";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function entry<B>(id: string, kind: Entry["kind"], title: string, summary: string, tags: string[], body: B, related: string[], ref: string): Entry<B> {
  return { id, kind, layer: "code", title, summary, tags: [...new Set(tags)].sort(), body, related,
    source: { kind: "code", ref, inputHash: hash(body) }, rev: hash(body) };
}

function properties(type: string): Entry[] {
  const groups = groupsOf(type);
  const groupOf = new Map(groups.flatMap((group) => group.fields.map((field) => [field.key, group.title] as const)));
  const walk = (field: SchemaField, group: string): Entry[] => {
    const path = field.path.join(".");
    const id = `prop:${type}.${path}`;
    const body = { type, path, fieldKind: field.kind, optional: field.optional, readOnly: field.readOnly,
      group, ...(field.options ? { options: field.options } : {}), ...(field.min !== undefined ? { min: field.min } : {}), ...(field.max !== undefined ? { max: field.max } : {}) };
    return [entry(id, "property", `${type} ${path}`, `${field.kind} property in ${group}.`, [type.toLowerCase(), field.kind.toLowerCase()], body,
      [`part:${type}`], `web/src/lib/ote/schema.ts#${type}`),
      ...(field.fields ?? []).flatMap((child) => walk(child, group)), ...(field.item ? walk(field.item, group) : [])];
  };
  return fieldsOf(type).flatMap((field) => walk(field, groupOf.get(field.key) ?? "Other"));
}

export function generateCode(): { version: string; entries: Entry[] } {
  const entries: Entry[] = [];
  for (const type of PART_TYPES) {
    const props = properties(type);
    entries.push(...props);
    const sample = { Type: type } as Part;
    const valueProperty = valuePropertyOf(sample);
    const accepts = valueProperty ? acceptedTypes(sample, valueProperty) : undefined;
    const emitted = OTE.capabilities.parts.includes(type);
    const body: PartTypeBody = { type, emitted, defaultSize: partDefaultSize(type), properties: props.map((p) => p.id),
      ...(valueProperty ? { valueProperty } : {}), ...(accepts ? { accepts } : {}) };
    const isReading = type === "NumericDisplay" || type === "StringDisplay";
    entries.push(entry(`part:${type}`, "partType", isReading ? `${type} reading` : type,
      isReading ? `${type} shows a live reading, including level. The OTE writer emits this part.` : `${type} is an OTE part the writer emits.`,
      [type.toLowerCase(), ...(emitted ? ["emitted"] : []), ...(isReading ? ["reading", "level"] : [])], body, props.map((p) => p.id), "web/src/lib/backend/ote.ts#capabilities.parts"));
  }
  for (const panel of PANELS) {
    const body: PanelBody = { model: panel.model, width: panel.width, height: panel.height, formats: [...panel.formats], viewing: panel.viewing, from: "code" };
    entries.push(entry(`panel:${panel.model}`, "panel", panel.model, `${panel.width}x${panel.height} ${panel.viewing} panel.`,
      [panel.model.toLowerCase(), `${panel.width}x${panel.height}`, ...panel.formats], body, [], "web/src/lib/backend/panels.ts#PANELS"));
  }
  for (const klass of MACHINE_CLASSES) {
    entries.push(entry(`class:${klass.id}`, "machineClass", klass.name, klass.description,
      [klass.id, ...klass.industries], { ...klass }, [], "web/src/lib/library/machines.ts#MACHINE_CLASSES"));
  }
  for (const level of [1, 2, 3] as const) {
    const body: PatternBody = { level, zones: { header: ZONES.HEADER, nav: ZONES.NAV, footer: ZONES.FOOTER, margin: ZONES.MARGIN, gap: ZONES.GAP },
      perPanel: PANELS.map((panel) => {
        const grid = gridFor(level, panel, true);
        return { panel: panel.model, columns: grid.columns, rows: grid.rows, cell: { width: grid.width, height: grid.height }, capacity: capacityOf(level, panel, true) };
      }) };
    entries.push(entry(`pattern:l${level}.grid`, "pattern", `Level ${level} reading grid`, `Level ${level} layout of readings and equipment on every listed panel.`,
      [`l${level}`, "level", "reading", ...PANELS.map((panel) => `${panel.width}x${panel.height}`)], body, PANELS.map((panel) => `panel:${panel.model}`),
      "web/src/lib/ote/layout.ts#gridFor"));
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { version: hash(entries), entries };
}
