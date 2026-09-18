/**
 * The critic: a vision pass over a rendered screen against the pack's
 * checklist. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.5, agent A4.
 *
 * It answers the questions the lint cannot: does the flow read left to
 * right, are the callouts beside what they measure, is the eye drawn to the
 * alarm and nothing else, is the layout balanced. It returns findings as
 * structured proposals against object names; it never edits. The engineer
 * accepts or discards each one, and what is accepted goes through the same
 * ops path the conversation uses - which is what keeps a critic from being a
 * model doing geometry one step removed.
 *
 * Null when no provider is configured, like the conversation.
 */

import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Screen } from "@/lib/ote/schema";
import { DEFAULT_PACK, type StandardPack } from "@/lib/standard/pack";
import { resolveProvider } from "@/lib/ai/provider";
import { screenToPng } from "./render";

export const CriticFinding = z.object({
  /** Which checklist item it is about. */
  rule: z.enum(["flow", "callouts", "salience", "balance", "labels", "density", "frame", "other"]),
  severity: z.enum(["warning", "info"]),
  /** The object's Name, when the finding is about one; the screen otherwise. */
  object: z.string().optional(),
  message: z.string(),
  /** What to do, in one sentence an engineer could act on. */
  suggestion: z.string(),
});
export type CriticFinding = z.infer<typeof CriticFinding>;

export const CriticReport = z.object({
  /** One sentence on the screen as a whole. */
  summary: z.string(),
  /** 1 (unusable) to 5 (reference quality), against the checklist. */
  score: z.number().int().min(1).max(5),
  findings: z.array(CriticFinding).max(12),
});
export type CriticReport = z.infer<typeof CriticReport>;

export interface CriticResult {
  report: CriticReport;
  provider: "claude" | "gemini";
  model: string;
}

/** The checklist, from the pack: the same standard the lint enforces, in the terms a picture is judged by. */
export function checklist(pack: StandardPack = DEFAULT_PACK): string {
  return [
    `You are reviewing an industrial HMI screen against ${pack.name} (${pack.basis}).`,
    "The screen is a design-time render: no live values, every lamp at rest, every indicator at its design value.",
    "Judge only what a picture can show. Do not report colours or font sizes; a lint checks those.",
    "",
    "Checklist:",
    "- flow: on a process view, does the process read left to right, sources on the left, in the order material moves? Are pipes between the symbols they join, never crossing a symbol?",
    "- callouts: is every reading (scale, value, unit) beside the equipment it measures, and read as belonging to it rather than to a neighbour?",
    "- salience: on a quiet screen, is nothing pulling the eye - no large block of tone, no crowded corner? Would an alarm colour, if it appeared, be the only thing that stands out?",
    "- balance: is the body used evenly, without a dense cluster and an empty region?",
    "- labels: does every symbol and every value have a label an operator can read at a glance? Are labels beside or under what they name?",
    "- density: is there room to read, or is the screen a wall?",
    "- frame: are the header, the navigation strip and the alarm band where an operator expects them, and consistent?",
    "",
    "Name the object by the name printed on it or by its label when a finding is about one object.",
    "Report only what an experienced HMI engineer would change. Fewer, better findings. Never invent an object.",
  ].join("\n");
}

const JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    score: { type: "integer", minimum: 1, maximum: 5 },
    findings: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          rule: { type: "string", enum: ["flow", "callouts", "salience", "balance", "labels", "density", "frame", "other"] },
          severity: { type: "string", enum: ["warning", "info"] },
          object: { type: "string" },
          message: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["rule", "severity", "message", "suggestion"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "score", "findings"],
  additionalProperties: false,
} as const;

/** What the screen holds, so the critic names real objects and nothing else. */
function inventory(screen: Screen): string {
  const parts = screen.Children[0].Children;
  const lines = parts
    .filter((p) => p.Type !== "Rectangle" || p.Name.startsWith("Card_") || p.Name.startsWith("Tile_"))
    .map((p) => {
      const text = "Text" in p && typeof p.Text === "string" ? ` "${p.Text}"` : "";
      return `- ${p.Name} (${p.Type}${text}) at ${p.Location.Left},${p.Location.Top} ${p.Width}x${p.Height}`;
    });
  return `Objects on ${screen.Name} (${parts.length} in all; backgrounds omitted):\n${lines.join("\n")}`;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function withClaude(png: Uint8Array, screen: Screen, model: string, pack: StandardPack): Promise<CriticResult | null> {
  const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
  const { jsonSchemaOutputFormat } = await import("@anthropic-ai/sdk/helpers/json-schema");
  const client: Anthropic = new AnthropicClient();
  const response = await client.messages.parse({
    model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { format: jsonSchemaOutputFormat(JSON_SCHEMA), effort: "medium" },
    system: [{ type: "text", text: checklist(pack), cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: toBase64(png) } },
          { type: "text", text: inventory(screen) },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") return null;
  const parsed = CriticReport.safeParse(response.parsed_output);
  return parsed.success ? { report: parsed.data, provider: "claude", model } : null;
}

async function withGemini(png: Uint8Array, screen: Screen, model: string, pack: StandardPack): Promise<CriticResult | null> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim() });
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/png", data: toBase64(png) } },
          { text: inventory(screen) },
        ],
      },
    ],
    config: {
      // The shape is stated in the instruction and checked by zod after;
      // Gemini's own schema dialect rejected the enums and answered nothing.
      systemInstruction:
        checklist(pack) +
        "\n\nAnswer as JSON: {summary: string, score: integer 1-5, findings: [{rule, severity, object?, message, suggestion}]} " +
        "with rule one of flow, callouts, salience, balance, labels, density, frame, other; severity warning or info; " +
        "object the printed name of one object, or omitted.",
      responseMimeType: "application/json",
      // The structural schema, so the JSON is well formed; the enums are in
      // the instruction and checked after, because Gemini's dialect refused
      // them and answered nothing.
      responseSchema: {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING" },
          score: { type: "INTEGER" },
          findings: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                rule: { type: "STRING" },
                severity: { type: "STRING" },
                object: { type: "STRING" },
                message: { type: "STRING" },
                suggestion: { type: "STRING" },
              },
              required: ["rule", "severity", "message", "suggestion"],
            },
          },
        },
        required: ["summary", "score", "findings"],
      },
      temperature: 0.2,
    },
  });
  const text = response.text;
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (process.env.CRITIC_DEBUG) console.error("[critic] gemini answered:", text);
    // A model that writes 4.0 for a score, or a rule outside the list, is
    // brought to the schema rather than refused for it.
    const findings = Array.isArray(raw.findings)
      ? (raw.findings as Record<string, unknown>[]).map((f) => ({
          ...f,
          rule: CriticFinding.shape.rule.options.includes(f.rule as never) ? f.rule : "other",
          severity: f.severity === "warning" ? "warning" : "info",
        }))
      : [];
    const parsed = CriticReport.safeParse({ ...raw, score: Math.round(Number(raw.score)), findings });
    if (!parsed.success && process.env.CRITIC_DEBUG) console.error("[critic] schema:", parsed.error.issues);
    return parsed.success ? { report: parsed.data, provider: "gemini", model } : null;
  } catch (error) {
    if (process.env.CRITIC_DEBUG) console.error("[critic] parse:", error, text);
    return null;
  }
}

/**
 * Review one screen. Findings that name an object the screen does not have
 * are dropped here, whatever the model said: a critic that invents objects
 * is worse than none.
 */
export async function critique(screen: Screen, pack: StandardPack = DEFAULT_PACK): Promise<CriticResult | null> {
  const choice = resolveProvider();
  if (!choice.provider || !choice.model) return null;
  const png = await screenToPng(screen);
  const result =
    choice.provider === "gemini"
      ? await withGemini(png, screen, choice.model, pack)
      : await withClaude(png, screen, choice.model, pack);
  if (!result) return null;
  const names = new Set(screen.Children[0].Children.map((p) => p.Name));
  const labels = new Map(
    screen.Children[0].Children.flatMap((p) => ("Text" in p && typeof p.Text === "string" ? [[p.Text.toLowerCase(), p.Name] as const] : [])),
  );
  const findings = result.report.findings.flatMap((f) => {
    if (!f.object) return [f];
    if (names.has(f.object)) return [f];
    const byLabel = labels.get(f.object.toLowerCase());
    return byLabel ? [{ ...f, object: byLabel }] : [];
  });
  return { ...result, report: { ...result.report, findings } };
}
