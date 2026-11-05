/**
 * The two ways a file reaches a project through the connector: an .eote that
 * becomes a project, and a tag export that lands on one. Both go through what
 * the app itself uses, so a file means the same thing whichever door it came in.
 */

import { z } from "zod";
import { refuse, sniff } from "@/lib/ingest/sniff";
import { DEFAULT_STANDARDS } from "@/store/types";
import { readProject } from "@/lib/ote/reader";
import { repo } from "@/lib/server/repo";
import { parseTagsFile } from "@/lib/tags/parse";
import { callerUser } from "./caller";
import { field, projectData } from "./data";
import { refusal } from "./result";
import { tool, type McpTool } from "./spec";
import { land } from "./write";

/** Past this a request body would not reach the function on Vercel: 4.5 MB less base64's third. */
const MOST_BYTES = 3 * 1024 * 1024;

function bytesOf(base64: string): Uint8Array | null {
  const raw = Buffer.from(base64, "base64");
  return raw.length > MOST_BYTES ? null : new Uint8Array(raw);
}
const tooBig = "That file is over 3 MB, too big to send through the connector. Open it on the Projects page instead.";
const fileName = (name: string) => name.replace(/^.*[\\/]/, "").slice(0, 255);

const openEote = tool({
  name: "open_eote",
  title: "Open an .eote",
  description: "Makes a new project from an Operator Terminal Expert .eote file. Whatever the editor does not model is carried and exports back unchanged. Older 3.x projects and larger files open on the app's Projects page.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  input: {
    fileName: z.string().min(1).max(255).describe("The file's name, ending in .eote."),
    contentBase64: z.string().min(1).describe("The file, base64 encoded."),
  },
  async run({ fileName: asked, contentBase64 }, { caller }) {
    const bytes = bytesOf(contentBase64);
    if (!bytes) return refusal(tooBig, "too-large");
    const name = fileName(asked);
    const kind = await sniff(bytes, name);
    const refused = refuse(kind, name);
    if (refused) return refusal(refused.message, "unsupported-format");
    if (kind.kind !== "ote-project") return refusal(`${field(name, 120)} is not an Operator Terminal Expert project.`, "unsupported-format");
    if (kind.layout === "struct") return refusal("That is an older 3.x project. Open it on the app's Projects page, which converts it.", "unsupported-format");

    const read = await readProject(bytes, name);
    const user = callerUser(caller);
    const sourceId = await repo().sources.put(bytes, name, user.id);
    const project = await repo().projects.create(user.id, {
      v: 3, id: crypto.randomUUID(), name: read.name, target: read.target, screens: read.screens,
      activeScreenId: read.screens[0]?.UniqueId, variables: read.variables, alarms: read.alarms,
      bindings: read.wires.map((w) => ({ tag: w.tag, targetId: w.part.UniqueId, targetName: w.part.Name, property: w.property, ...(w.converter ? { converter: w.converter } : {}) })),
      objectMeta: {}, screenPlacement: {}, standards: DEFAULT_STANDARDS, versions: [], chat: [],
      source: sourceId, sourceId, layout: kind.layout, foreign: read.foreign ?? {},
    } as never, kind.layout);
    return {
      text: [
        `Opened as project ${project._id}: ${read.screens.length} screens, ${read.variables.length} tags. Changes to it need confirm: true, because it exports back into this file.`,
        projectData("warnings", read.warnings.length ? read.warnings : ["none"]),
      ].join("\n"),
      structured: { projectId: project._id, screens: read.screens.length, tags: read.variables.length, warnings: read.warnings },
    };
  },
});

const importTags = tool({
  name: "import_tags",
  title: "Import tags",
  description: "Replaces a project's tag list from a PLC tag export (.csv, .xlsx or Control Expert .xml). Goes through the same checks as apply_ops: a proposal unless direct writes are on. Names OTE would refuse are corrected and the corrections are reported.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  input: {
    projectId: z.string().describe("The project id, from list_projects."),
    fileName: z.string().min(1).max(255).describe("The file's name; its extension says how to read it."),
    contentBase64: z.string().min(1).describe("The file, base64 encoded."),
    confirm: z.boolean().optional().describe("Must be true to write directly into a project that was opened from a file."),
  },
  async run({ projectId, fileName: asked, contentBase64, confirm }, { caller }) {
    const bytes = bytesOf(contentBase64);
    if (!bytes) return refusal(tooBig, "too-large");
    const name = fileName(asked);
    const parsed = await parseTagsFile(bytes, name);
    if (parsed.variables.length === 0) return refusal(`No tags could be read from ${field(name, 120)}.`, "no-tags");
    const landed = await land(caller, projectId, {
      ops: [],
      note: `Imported ${parsed.variables.length} tags from ${name} through the claude.ai connector`,
      seed: {
        variables: parsed.variables,
        tagImport: { fileName: name, at: Date.now(), corrections: parsed.corrections, skipped: parsed.skipped, summary: parsed.summary, ...(parsed.structure ? { structure: parsed.structure } : {}) },
      },
      ...(confirm === undefined ? {} : { confirm }),
    });
    const told = `${parsed.variables.length} tags read, ${parsed.corrections.length} names corrected, ${parsed.skipped.length} rows skipped.`;
    return { ...landed, text: `${told}\n${landed.text}` };
  },
});

export const INTAKE_TOOLS: readonly McpTool[] = [openEote, importTags];
