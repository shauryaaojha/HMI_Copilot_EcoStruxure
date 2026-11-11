/**
 * Three tools that take guessing out of the connector's work.
 *
 * - `replace_screen`: a screen given again replaces the old one in one change,
 *   so the same input always gives the same screen and never a second copy.
 *   The connector's logs had five "remove duplicates" proposals in a week,
 *   all from a screen sent twice and accepted twice.
 * - `draft_tags`: when there is no tag export, the tags come from the plant
 *   brief's catalogue and naming rule, not from a model's idea of a name.
 * - `match_tags`: a phrase from the engineer ("pump 2 fault") resolved to a
 *   tag with a stated confidence, so a binding is made only when one tag is
 *   clearly meant and a question is asked otherwise.
 */
import { z } from "zod";
import { Op } from "@/core/ops";
import { scoredTags } from "@/lib/ai/retrieve";
import { Brief, problemsWith, tagsFromBrief } from "@/lib/brief/brief";
import { CATALOGUE, KIND_IDS } from "@/lib/brief/catalogue";
import type { Variable } from "@/lib/ote/schema";
import { field, limited, projectData, RESULT_LIMIT } from "./data";
import { openProject } from "./project";
import { refusal } from "./result";
import { tool, type McpTool } from "./spec";
import { land } from "./write";

const Ops = z.array(Op).max(200);

/** The ops a replacement runs: clear the screen (or add it), then draw it again. */
export function replacementOps(
  doc: { screens: { UniqueId: string; Name: string; Children: { Children: { UniqueId: string }[] }[] }[]; handles?: Record<string, string> },
  screen: string,
  ops: z.infer<typeof Ops>,
): { ops: z.infer<typeof Ops>; existed: boolean; cleared: number; name: string } {
  const wanted = screen.trim().toLowerCase();
  const found = doc.screens.find((s) => s.Name.toLowerCase() === wanted || (doc.handles?.[s.UniqueId] ?? "").toLowerCase() === wanted || s.UniqueId.toLowerCase() === wanted);
  const name = found?.Name ?? screen.trim();
  // An addObject that names no screen goes on this one; anything else is passed as written.
  const drawn = ops.map((op) => (op.op === "addObject" && !op.screen ? { ...op, screen: name } : op));
  if (!found) return { ops: [{ op: "addScreen", name } as z.infer<typeof Op>, ...drawn], existed: false, cleared: 0, name };
  const parts = (found.Children[0]?.Children ?? []) as { UniqueId: string; Name?: string }[];
  // By handle when there is one, else by name: names are unique across a
  // project because bindings resolve by them, and a UniqueId is not an op target.
  const clear = parts.map((p) => ({ op: "deleteObject", target: doc.handles?.[p.UniqueId] ?? p.Name ?? p.UniqueId }) as z.infer<typeof Op>);
  return { ops: [...clear, ...drawn], existed: true, cleared: parts.length, name };
}

const replaceScreen = tool({
  name: "replace_screen",
  title: "Replace a screen",
  description:
    "Makes one screen exactly what the ops describe, whatever is on it now: every object on it is removed and the ops are applied in the same change. Sending the same screen twice gives the same result and never a duplicate. If no screen has that name it is added. Use it when the engineer gives a screen again, sends a corrected version, or says redo, rebuild or overwrite; use apply_ops for a change to what is already there. Bindings and actions of the removed objects go with them; other screens and the tag list are untouched. addObject ops that name no screen go on this one.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  input: {
    projectId: z.string().describe("The project id, from list_projects."),
    screen: z.string().min(1).max(80).describe("The screen's exact name or handle, e.g. Home or s2. A new name adds the screen."),
    ops: Ops.describe("Everything the screen should hold, in order: addObject, then setText, setColor, setStyle, bindTag, setAction on those objects."),
    note: z.string().max(2000).optional().describe("One line on why the screen is being replaced."),
    confirm: z.boolean().optional().describe("Needed only when direct writes are on: removing objects needs the engineer's agreement. Proposals do not need it."),
  },
  async run({ projectId, screen, ops, note, confirm }, { caller }) {
    const { doc } = await openProject(caller, projectId, "edit");
    const plan = replacementOps(doc as never, screen, ops);
    if (plan.ops.length > 600) return refusal(`That is ${plan.ops.length} ops with the clearing; split the screen's contents over two calls of apply_ops after one replace_screen.`, "too-large");
    const landed = await land(caller, projectId, {
      ops: plan.ops,
      note: note ?? `Replaced screen ${plan.name} through the claude.ai connector`,
      ...(confirm === undefined ? {} : { confirm }),
    });
    const said = plan.existed
      ? `Replacing ${plan.name}: its ${plan.cleared} objects are removed and ${ops.length} ops draw it again, in one change.`
      : `${plan.name} did not exist, so it is added and drawn with ${ops.length} ops.`;
    return { ...landed, text: `${said}\n${landed.text}` };
  },
});

const draftTags = tool({
  name: "draft_tags",
  title: "Draft tags",
  description:
    `Turns a plant described as units into a PLC tag list with the product's naming rule, <PREFIX>_<NNN>_<SIGNAL> (PMP_101_RUN, LT_101_PV), numbering from 101. Nothing is written: show the list to the engineer, and once they agree pass it to create_project's tags or to apply_ops addTag. Use it only when the engineer has no tag export; when they have one, import_tags reads it. Kinds: ${CATALOGUE.map((k) => `${k.id} (${k.prefix}: ${k.signals.map((s) => s.id).join("/")})`).join("; ")}. A unit outside the catalogue is kind "custom" with its signals written out.`,
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: {
    units: z
      .array(
        z.object({
          kind: z.string().describe(`One of ${KIND_IDS.join(", ")}, or custom.`),
          label: z.string().min(1).max(60).describe("What the engineer calls it, e.g. Feed pump."),
          count: z.number().int().min(1).max(100).describe("How many. Ask when the engineer did not say; never assume."),
          signals: z.array(z.string()).optional().describe("Signal ids from the kind's list; the kind's usual set if left out."),
          customSignals: z
            .array(z.object({ id: z.string().regex(/^[A-Z][A-Z0-9_]{0,15}$/), type: z.enum(["BOOL", "INT", "DINT", "REAL", "LREAL", "STRING"]), what: z.string().max(60).optional() }))
            .optional()
            .describe("For kind custom only: each signal with its id (upper case), type and meaning."),
        }),
      )
      .min(1)
      .max(60),
    start: z.number().int().min(1).max(9000).optional().describe("The first unit number; 101 if left out."),
  },
  async run({ units, start }) {
    const parsed = Brief.safeParse({
      units: units.map((u, i) => {
        const kind = CATALOGUE.find((k) => k.id === u.kind);
        return {
          id: `u${i + 1}`,
          kind: kind ? kind.id : "custom",
          label: u.label,
          count: u.count,
          signals: kind ? (u.signals?.length ? u.signals : kind.defaultSignals) : (u.customSignals ?? []).map((s) => s.id),
          ...(kind ? {} : { customSignals: (u.customSignals ?? []).map((s) => ({ ...s, what: s.what ?? "" })) }),
        };
      }),
      ...(start ? { naming: { pattern: "<PREFIX>_<NNN>_<SIGNAL>", start } } : {}),
    });
    if (!parsed.success) return refusal(`These units cannot be drafted: ${parsed.error.issues[0]?.message ?? "invalid"}.`, "invalid");
    const problems = problemsWith(parsed.data);
    if (problems.length) return refusal(`These units cannot be drafted yet: ${problems.map((p) => p.message).join("; ")}.`, "invalid");
    const { variables } = tagsFromBrief(parsed.data);
    const lines = variables.map((v) => `${v.Name} ${v.DataType} - ${v.Comments}`);
    return {
      text: [
        `${variables.length} tags drafted. These are placeholders until the engineer's PLC program has the real ones; show them and ask before using them.`,
        projectData("tags", limited(lines, RESULT_LIMIT - 2_000)),
      ].join("\n"),
      structured: { tags: variables.map((v) => ({ name: v.Name, dataType: v.DataType, comment: v.Comments })) },
    };
  },
});

/** One phrase, settled or not. Settled only when a single tag is clearly ahead. */
export function settle(variables: Variable[], phrase: string) {
  let ranked = scoredTags(variables, phrase, 6);
  if (ranked.length === 0) return { phrase, status: "none" as const, candidates: [] as { name: string; dataType: string; comment: string }[] };
  // A number the engineer said picks the unit: "pump 2 fault" is not pump 1's
  // fault however well the other words match. Kept only when something has it.
  const numbers = phrase.match(/\b\d+\b/g) ?? [];
  if (numbers.length) {
    const has = (v: Variable) => {
      const words = new Set(`${v.Name} ${v.Comments ?? ""}`.toLowerCase().split(/[^a-z0-9]+/));
      return numbers.every((n) => words.has(n));
    };
    const numbered = ranked.filter((r) => has(r.tag));
    if (numbered.length) ranked = numbered;
  }
  ranked = ranked.slice(0, 4);
  // The engineer's words appearing as they said them in exactly one tag's
  // comment or name settle it: "tank level" is "Tank level, percent", not
  // "Tank high level".
  const said = phrase.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const verbatim = ranked.filter((r) => ` ${`${r.tag.Comments ?? ""} ${r.tag.Name.replace(/_/g, " ")}`.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `.includes(` ${said} `));
  if (verbatim.length === 1 && verbatim[0] !== ranked[0]) ranked = [verbatim[0], ...ranked.filter((r) => r !== verbatim[0])];
  const [first, second] = ranked;
  const sure = !second || first.score >= second.score * 1.5 || (verbatim.length === 1 && verbatim[0] === first);
  return {
    phrase,
    status: sure ? ("sure" as const) : ("ambiguous" as const),
    tag: sure ? first.tag.Name : undefined,
    candidates: ranked.map((r) => ({ name: r.tag.Name, dataType: r.tag.DataType, comment: r.tag.Comments ?? "" })),
  };
}

const matchTags = tool({
  name: "match_tags",
  title: "Match phrases to tags",
  description:
    "Resolves the engineer's words for signals ('pump 2 fault', 'tank level', 'start button') to tags in the project's list, each with a status: sure (one tag is clearly meant, bind it), ambiguous (ask the engineer which, listing the candidates), or none (the tag does not exist: ask, or offer to add it with addTag). The same phrases on the same tag list always give the same answer. Use it before every bindTag whose tag the engineer did not name exactly.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: {
    projectId: z.string().describe("The project id, from list_projects."),
    phrases: z.array(z.string().min(1).max(200)).min(1).max(60).describe("One phrase per signal, in the engineer's words."),
  },
  async run({ projectId, phrases }, { caller }) {
    const { doc } = await openProject(caller, projectId, "read");
    const variables = doc.variables as Variable[];
    const results = phrases.map((p) => settle(variables, p));
    const lines = results.map((r) =>
      r.status === "sure"
        ? `sure: "${field(r.phrase, 120)}" -> ${field(r.tag!, 120)} (${field(r.candidates[0].dataType, 20)})`
        : r.status === "ambiguous"
          ? `ambiguous: "${field(r.phrase, 120)}" -> one of ${r.candidates.map((c) => `${field(c.name, 80)} (${field(c.comment, 60)})`).join(", ")}; ask the engineer`
          : `none: "${field(r.phrase, 120)}" matches no tag; ask, or add it with addTag`,
    );
    return {
      text: projectData("matches", limited(lines, RESULT_LIMIT - 1_000)),
      structured: { results: results.map((r) => ({ phrase: r.phrase, status: r.status, ...(r.tag ? { tag: r.tag } : {}), candidates: r.candidates.map((c) => c.name) })), tags: variables.length },
    };
  },
});

export const SCREEN_TOOLS: readonly McpTool[] = [replaceScreen, draftTags, matchTags];
