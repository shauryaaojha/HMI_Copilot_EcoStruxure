/**
 * How a project begins through the connector: a new empty one, an .eote that
 * becomes one, and a tag export that lands on one. All go through what the
 * app itself uses, so a project means the same thing whichever door it came in.
 */

import { z } from "zod";
import { refuse, sniff } from "@/lib/ingest/sniff";
import { DEFAULT_STANDARDS } from "@/store/types";
import { DEFAULT_PANEL, PANELS, panelNamed } from "@/lib/backend/panels";
import { panelOf } from "@/lib/ote/packager";
import { DATA_TYPES, Variable } from "@/lib/ote/schema";
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

/** A name the product and a file system both take: letters, digits, space, dash and underscore. */
const projectName = (asked: string) => asked.trim().replace(/[^A-Za-z0-9 _-]+/g, "_").replace(/\s+/g, " ").slice(0, 80).trim();

/** The asked name, or the next free "<name>_2", so two projects are never told apart only by their id. */
function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name}_${n}`.toLowerCase())) return `${name}_${n}`;
}

const createProject = tool({
  name: "create_project",
  title: "Create a project",
  description:
    "Makes a new, empty HMI project the engineer owns, optionally with a tag list, and returns its id. Use it when the work is for a plant or machine that none of the projects in list_projects is for: never put one machine's screens into another machine's project. Then use generate to lay out screens, or apply_ops with addScreen to draw them. Changes to it wait as proposals for the engineer to accept in the app, unless directWrites is true.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  input: {
    name: z.string().min(1).max(80).describe("The project's name, e.g. Coffee_Machine. If the engineer already has one with this name, a number is added."),
    panel: z.enum(PANELS.map((p) => p.model) as [string, ...string[]]).optional().describe(`The target panel the screens are laid out for. ${DEFAULT_PANEL.model} (${DEFAULT_PANEL.width} x ${DEFAULT_PANEL.height}) if left out. ${PANELS.map((p) => `${p.model} is ${p.width} x ${p.height}`).join("; ")}. The exported file declares ${DEFAULT_PANEL.model} whichever is picked; for another panel the engineer changes the target in OTE after opening it.`),
    tags: z
      .array(
        z.object({
          name: z.string().describe("The tag's name as OTE takes it: letters, digits and underscores, starting with a letter. BOILER_TEMP, not 'Boiler temp'."),
          dataType: z.enum(DATA_TYPES).describe("BOOL for a state or a command, REAL or INT for a measurement or a setpoint, STRING for text."),
          comment: z.string().max(200).optional().describe("What it is, in a few words. Alarm messages and labels are written from this."),
          address: z.string().max(80).optional().describe("The device address, when it is known."),
        }),
      )
      .max(2000)
      .optional()
      .describe("The PLC tags, when the engineer gave them or agreed to a set. A project can also start with none: generate takes a plant brief and makes placeholder tags."),
    directWrites: z.boolean().optional().describe("True only when the engineer has said changes may land without their accepting each one. Left out, every change waits as a proposal."),
  },
  async run({ name: asked, panel, tags, directWrites: direct }, { caller }) {
    const name = projectName(asked);
    if (!name) return refusal("That name has no letters or digits in it. Give the project a name such as Coffee_Machine.", "invalid");
    const variables: Variable[] = [];
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const t of tags ?? []) {
      const parsed = Variable.safeParse({ Name: t.name, DataType: t.dataType, Comments: t.comment ?? "", DeviceAddress: t.address ?? "" });
      if (!parsed.success) bad.push(`${field(t.name, 60)}: ${field(parsed.error.issues[0]?.message ?? "not a valid tag", 120)}`);
      else if (seen.has(parsed.data.Name)) bad.push(`${field(t.name, 60)}: listed twice`);
      else {
        seen.add(parsed.data.Name);
        variables.push(parsed.data);
      }
    }
    if (bad.length) {
      return refusal(
        [`Nothing was created: ${bad.length} of the ${tags!.length} tags cannot be used as they are. Correct them and call create_project again.`, projectData("tags refused", bad.slice(0, 40))].join("\n"),
        "invalid",
      );
    }

    const user = callerUser(caller);
    const storage = repo();
    const mine = await storage.projects.list(user.id);
    const target = panelNamed(panel ?? DEFAULT_PANEL.model) ?? DEFAULT_PANEL;
    const project = await storage.projects.create(user.id, {
      v: 3, id: crypto.randomUUID(), name: freeName(name, new Set(mine.map((p) => p.name.toLowerCase()))),
      target: { model: target.model, width: target.width, height: target.height },
      screens: [], variables, alarms: [], bindings: [],
      objectMeta: {}, screenPlacement: {}, standards: DEFAULT_STANDARDS, versions: [], chat: [], foreign: {},
    } as never);
    if (direct === true) await storage.projects.connector(project._id, { directWrites: true });
    // The .eote is written on the one project skeleton there is, and its
    // Target.dat is the panel the file declares: a panel's Target.dat cannot
    // be invented (OTE maps it to real hardware). So a project for another
    // panel is designed for that panel, and says plainly what the file names.
    const file = await panelOf().catch(() => null);
    const differs = !!file && (file.model !== target.model || file.width !== target.width || file.height !== target.height);
    return {
      text: [
        `Created project ${project._id} "${field(project.name, 120)}" for ${target.model} (${target.width} x ${target.height}), with ${variables.length} tags and no screens yet.`,
        ...(differs
          ? [`Tell the engineer: the screens are laid out for ${target.model} ${target.width} x ${target.height}, but the exported .eote declares ${file!.model} ${file!.width} x ${file!.height}, the only panel file this server has. After opening it in Operator Terminal Expert, change the target panel to ${target.model} there.`]
          : []),
        direct === true
          ? "Direct writes are on: what you change next lands at once."
          : "What you change next waits as proposals; the engineer accepts them in the app, on this project's page.",
        "Next: generate lays out screens from a plant brief or from the tags, and apply_ops with addScreen draws them one by one.",
      ].join("\n"),
      structured: { projectId: project._id, name: project.name, panel: target.model, width: target.width, height: target.height, tags: variables.length, directWrites: direct === true, ...(differs ? { fileDeclares: file!.model } : {}) },
    };
  },
});

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

export const INTAKE_TOOLS: readonly McpTool[] = [createProject, openEote, importTags];
