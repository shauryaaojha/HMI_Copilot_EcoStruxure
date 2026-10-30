/**
 * One funnel for everything a tool answers.
 *
 * Tools return a `ToolOutput` - plain data - and this turns it into the MCP
 * `CallToolResult`. Keeping that conversion in one place is what makes the
 * cap in `data.ts` unskippable: there is no second way for a tool to put
 * text on the wire, so no tool can forget it.
 *
 * It is also the seam for MCP Apps (stream S7). An interactive card is
 * attached to a *result*, as `_meta.ui`, not to the tool definition
 * (docs/RESEARCH_CLAUDE_AI_INTEGRATION.md, "What MCP Apps adds"). A tool that
 * wants one sets `ui` on its output and nothing else about it changes.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { capped } from "./data";

export interface ToolOutput {
  /** What the model reads. Capped at Claude's result limit on the way out. */
  text?: string;
  /** A rendered screen: raw PNG bytes, encoded here rather than by the tool. */
  image?: { bytes: Uint8Array; mimeType: string };
  /** The same answer as fields, for a client that would rather parse it. */
  structured?: Record<string, unknown>;
  /**
   * An MCP Apps card for this result (stream S7). Travels as `_meta.ui`; the
   * host ignores it when the connector has no UI resources.
   */
  ui?: Record<string, unknown>;
  /** A refusal or a failure. The message still goes in `text`. */
  isError?: boolean;
}

/** A tool's answer as MCP content. */
export function toolResult(output: ToolOutput): CallToolResult {
  const content: CallToolResult["content"] = [];
  if (output.text !== undefined) content.push({ type: "text", text: capped(output.text) });
  if (output.image) {
    content.push({ type: "image", data: Buffer.from(output.image.bytes).toString("base64"), mimeType: output.image.mimeType });
  }
  return {
    content,
    ...(output.structured ? { structuredContent: output.structured } : {}),
    ...(output.ui ? { _meta: { ui: output.ui } } : {}),
    ...(output.isError ? { isError: true } : {}),
  };
}

/**
 * A refusal, in the shape a tool error takes in MCP: a result the model can
 * read and relay, not a transport error. A caller who lacks a role has to be
 * told so in words - "ask the owner for editor access" is useful, a JSON-RPC
 * error code is not.
 */
export const refusal = (text: string, code?: string): ToolOutput => ({
  text,
  isError: true,
  ...(code ? { structured: { refused: true, code } } : { structured: { refused: true } }),
});
