/**
 * Screens before tags: the two model calls the screens-first workflow needs.
 *
 * The generator reads equipment from tag names, so a project with no tag
 * export has nothing to lay out. Rather than a second generator, the engineer's
 * description is turned into a tag list first - placeholder names in the
 * convention the inference reads (PMP_101_RUN, LT_101_PV) - and the ordinary
 * pipeline builds from that. The project records the list as assumed
 * (TagImport.pending), so the export leaves the placeholders out.
 *
 * When the real export arrives, each placeholder is matched to a real tag and
 * renamed everywhere it is used, so every object the generator bound is bound
 * for real without anyone touching it. What cannot be matched is reported and
 * left unbound.
 *
 * Both calls have a deterministic fallback, so the workflow runs with no key
 * and no network; the model only does them better. Its answers are checked,
 * never trusted: a drafted name must be a legal OTE name, a match must name a
 * tag that exists and has a compatible type.
 */
import { Variable } from "@/lib/ote/schema";
import { isBool, matchByRules } from "@/lib/tags/binder";
import { activeProvider, resolveProvider } from "./provider";

type Draft = Variable;

const env = (name: string) => process.env[name]?.trim() || undefined;

/** One JSON object from whichever model is configured, or null on any failure. */
async function askJson(system: string, prompt: string, schema: Record<string, unknown>): Promise<unknown> {
  const provider = activeProvider();
  if (!provider) return null;
  try {
    if (provider === "gemini") {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: env("GEMINI_API_KEY")! });
      const response = await ai.models.generateContent({
        model: resolveProvider().model ?? "gemini-flash-lite-latest",
        contents: prompt,
        config: { systemInstruction: system, responseMimeType: "application/json", temperature: 0.2 },
      });
      return response.text ? JSON.parse(response.text) : null;
    }
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { betaJSONSchemaOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/json-schema");
    const response = await new Anthropic().beta.messages.parse({
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      model: resolveProvider().model ?? "claude-opus-5-5",
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: betaJSONSchemaOutputFormat(schema as never) },
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    return response.parsed_output;
  } catch {
    // The caller falls back to the rules and says so.
    return null;
  }
}

/* --- drafting a tag list from a description ------------------------------ */

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    tags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          dataType: { type: "string", enum: ["BOOL", "INT", "DINT", "REAL"] },
          comment: { type: "string" },
        },
        required: ["name", "dataType", "comment"],
        additionalProperties: false,
      },
    },
  },
  required: ["tags"],
  additionalProperties: false,
};

const DRAFT_SYSTEM = [
  "You draft the PLC tag list an HMI for the described plant would need, before the real tag export exists.",
  "Name tags <PREFIX>_<NNN>_<SIGNAL>: PMP pump, MTR motor, CNV conveyor, XV valve, TNK tank, LT level, FT flow, PT pressure, TT temperature, AG agitator, FAN fan, CMP compressor.",
  "Signals: RUN, FLT, START, STOP (BOOL) for drives; OPEN, CLOSED, FLT (BOOL) for valves; PV (REAL) for a transmitter, HI and LO (BOOL) for its limits.",
  "Number units from 101 in the order the description names them. Give each a short comment saying what it is, e.g. 'Transfer pump 1 running'.",
  "List only equipment the description names or clearly implies. No addresses.",
].join(" ");

/** Equipment words the rules recognise, and the tags each unit gets. */
const KINDS: { pattern: RegExp; prefix: string; label: string; signals: [string, Variable["DataType"], string][] }[] = [
  { pattern: /\bpumps?\b/i, prefix: "PMP", label: "Pump", signals: [["RUN", "BOOL", "running"], ["FLT", "BOOL", "fault"], ["START", "BOOL", "start command"], ["STOP", "BOOL", "stop command"]] },
  { pattern: /\bmotors?\b/i, prefix: "MTR", label: "Motor", signals: [["RUN", "BOOL", "running"], ["FLT", "BOOL", "fault"], ["START", "BOOL", "start command"], ["STOP", "BOOL", "stop command"]] },
  { pattern: /\bconveyors?\b/i, prefix: "CNV", label: "Conveyor", signals: [["RUN", "BOOL", "running"], ["FLT", "BOOL", "fault"]] },
  { pattern: /\bfans?\b/i, prefix: "FAN", label: "Fan", signals: [["RUN", "BOOL", "running"], ["FLT", "BOOL", "fault"]] },
  { pattern: /\bvalves?\b/i, prefix: "XV", label: "Valve", signals: [["OPEN", "BOOL", "open"], ["CLOSED", "BOOL", "closed"], ["FLT", "BOOL", "fault"]] },
  { pattern: /\btanks?\b|\bvessels?\b/i, prefix: "LT", label: "Tank level", signals: [["PV", "REAL", ""], ["HI", "BOOL", "high"], ["LO", "BOOL", "low"]] },
  { pattern: /\bflow\b/i, prefix: "FT", label: "Flow", signals: [["PV", "REAL", ""], ["LO", "BOOL", "low"]] },
  { pattern: /\bpressure\b/i, prefix: "PT", label: "Pressure", signals: [["PV", "REAL", ""], ["HI", "BOOL", "high"]] },
  { pattern: /\btemperature\b|\btemp\b/i, prefix: "TT", label: "Temperature", signals: [["PV", "REAL", ""], ["HI", "BOOL", "high"]] },
];
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 };

/** How many of a kind the sentence asks for: "two duty pumps", "3 tanks", else one. */
function countOf(intent: string, pattern: RegExp): number {
  const counted = new RegExp(`\\b(\\d+|${Object.keys(NUMBERS).join("|")})(?:\\s+[a-z-]+){0,2}\\s+(?:${pattern.source})`, "gi");
  // The largest count wins: "a pump station with two duty pumps" is two pumps.
  const counts = [...intent.matchAll(counted)].map((m) => Number(m[1]) || NUMBERS[m[1].toLowerCase()] || 1);
  return Math.min(Math.max(1, ...counts), 20);
}

/** The rules' draft: a unit per equipment word, its count read from the sentence. */
export function draftByRules(intent: string): Draft[] {
  const out: Draft[] = [];
  for (const kind of KINDS.filter((k) => k.pattern.test(intent))) {
    for (let i = 1; i <= countOf(intent, kind.pattern); i++) {
      const id = `${kind.prefix}_${100 + i}`;
      for (const [signal, DataType, what] of kind.signals) {
        out.push({ Name: `${id}_${signal}`, DataType, Comments: `${kind.label} ${i}${what ? ` ${what}` : ""}`, DeviceAddress: "" });
      }
    }
  }
  return out;
}

/** The model's draft, kept only where each row is a legal, unique OTE variable. */
export function coerceDraft(value: unknown): Draft[] {
  const rows = (value as { tags?: unknown })?.tags;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: Draft[] = [];
  for (const row of rows) {
    const r = row as { name?: unknown; dataType?: unknown; comment?: unknown };
    const parsed = Variable.safeParse({ Name: r.name, DataType: r.dataType, Comments: typeof r.comment === "string" ? r.comment : "", DeviceAddress: "" });
    if (!parsed.success || seen.has(parsed.data.Name.toUpperCase())) continue;
    seen.add(parsed.data.Name.toUpperCase());
    out.push(parsed.data);
  }
  return out.slice(0, 400);
}

/** Placeholder tags for a described plant: the model's when it answers sensibly, else the rules'. */
export async function draftTags(intent: string): Promise<{ variables: Draft[]; by: "model" | "rules" }> {
  const drafted = coerceDraft(await askJson(DRAFT_SYSTEM, intent, DRAFT_SCHEMA));
  if (drafted.length > 0) return { variables: drafted, by: "model" };
  return { variables: draftByRules(intent), by: "rules" };
}

/* --- matching placeholders to the real export ----------------------------- */

const MATCH_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: { placeholder: { type: "string" }, tag: { type: ["string", "null"] } },
        required: ["placeholder", "tag"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

const MATCH_SYSTEM = [
  "An HMI was designed against placeholder PLC tags before the real tag export existed. Map each placeholder to the real tag that carries the same signal of the same equipment.",
  "Use names, comments and data types. A BOOL only maps to a BOOL, a number only to a number.",
  "Answer null for a placeholder when no real tag clearly fits, or when two fit equally: an engineer will bind it by hand. Never invent a tag.",
].join(" ");

const line = (v: Variable) => `${v.Name} (${v.DataType})${v.Comments ? `: ${v.Comments}` : ""}`;

/** The model's matches, kept only where the tag exists, is not a placeholder, and has a compatible type. */
export function coerceMatches(value: unknown, placeholders: Variable[], real: Variable[]): Record<string, string> | null {
  const rows = (value as { matches?: unknown })?.matches;
  if (!Array.isArray(rows)) return null;
  const mine = new Map(placeholders.map((v) => [v.Name, v]));
  const theirs = new Map(real.map((v) => [v.Name, v]));
  const out: Record<string, string> = {};
  for (const row of rows) {
    const r = row as { placeholder?: unknown; tag?: unknown };
    const p = typeof r.placeholder === "string" ? mine.get(r.placeholder) : undefined;
    const t = typeof r.tag === "string" ? theirs.get(r.tag) : undefined;
    if (p && t && isBool(p) === isBool(t)) out[p.Name] = t.Name;
  }
  return out;
}

/** Real tag per placeholder, where one is clear: the model's answer when it gives one, else the rules'. */
export async function matchTags(placeholders: Variable[], real: Variable[]): Promise<{ renames: Record<string, string>; by: "model" | "rules" }> {
  if (placeholders.length === 0 || real.length === 0) return { renames: {}, by: "rules" };
  const prompt = `Placeholders:\n${placeholders.map(line).join("\n")}\n\nReal tags:\n${real.map(line).join("\n")}`;
  const matched = coerceMatches(await askJson(MATCH_SYSTEM, prompt, MATCH_SCHEMA), placeholders, real);
  if (matched) return { renames: matched, by: "model" };
  return { renames: matchByRules(placeholders, real), by: "rules" };
}
