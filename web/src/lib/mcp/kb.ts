import { z } from "zod";
import { loadKb } from "@/lib/kb";
import { getEntry, searchEntries } from "@/lib/kb/serve";
import { tool, type McpTool } from "./spec";

const kinds = z.array(z.enum(["partType", "property", "component", "pattern", "rule", "panel", "driver", "tagConvention", "machineClass", "symbol", "example"])).max(5).optional();

export const KB_TOOLS: readonly McpTool[] = [
  tool({
    name: "kb_search", title: "Search HMI knowledge",
    description: "Searches repository-derived parts, panels, machine classes, patterns and enforced rules. Returns at most eight short entries. No project scan or installation data is served.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    input: { query: z.string().min(1).max(400), kinds, tags: z.array(z.string().max(60)).max(8).optional() },
    async run({ query, kinds, tags }) {
      const kb = loadKb();
      if (!kb) return { text: "The indexed knowledge base is unavailable.", isError: true };
      const hits = searchEntries(kb, query, "mcp", { kinds, tags });
      return { text: JSON.stringify(hits), structured: { hits, version: kb.version } };
    },
  }),
  tool({
    name: "kb_get", title: "Get HMI knowledge entry",
    description: "Gets one repository-derived knowledge entry by id with a bounded body and source. Raw project scans and installation data are never served.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    input: { id: z.string().min(1).max(200) },
    async run({ id }) {
      const kb = loadKb();
      if (!kb) return { text: "The indexed knowledge base is unavailable.", isError: true };
      const entry = getEntry(kb, id, "mcp");
      if (!entry) return { text: "No such public knowledge entry.", isError: true };
      // Where an entry was derived from is ours (a source file path); the
      // entry itself is what the caller needs.
      const shown = { ...entry, source: entry.source ? { kind: entry.source.kind } : undefined };
      return { text: JSON.stringify(shown), structured: { entry: shown, version: kb.version } };
    },
  }),
];
