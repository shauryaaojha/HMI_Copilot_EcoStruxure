/**
 * The tool table, and the one place a tool is registered.
 *
 * Adding a tool is adding an entry to `TOOLS`; nothing else in the server
 * knows the list. M3's `generate` went in exactly that way - one more table
 * spread below - and got the caller resolution, the role gate, the size cap
 * and the refusal handling for free.
 *
 * Refusals are results, not transport errors. `access.ts` throws a
 * `ServerError` when a caller has no role on a project, and the useful thing
 * to do with "you are not an editor on this project" is hand it to the model
 * to relay, which is what `isError` content is for. A JSON-RPC error would
 * reach the user as a broken connector instead.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IngestError } from "@/lib/ingest/errors";
import { ServerError } from "@/lib/server/errors";
import { logGaps } from "@/lib/server/gaps";
import { GENERATE_TOOLS } from "./generate";
import { INTAKE_TOOLS } from "./intake";
import { KB_TOOLS } from "./kb";
import { MANAGE_TOOLS } from "./manage";
import { READ_TOOLS } from "./read";
import { refusal, toolResult, type ToolOutput } from "./result";
import type { McpTool, ToolContext } from "./spec";
import { WRITE_TOOLS } from "./write";

export const TOOLS: readonly McpTool[] = [...READ_TOOLS, ...KB_TOOLS, ...WRITE_TOOLS, ...INTAKE_TOOLS, ...MANAGE_TOOLS, ...GENERATE_TOOLS];

/**
 * The scope a narrowed credential needs for this tool, or null when it has it.
 *
 * A caller with no scopes (a session, a personal token) is not narrowed. A tool
 * not marked read-only counts as a write, so a tool added without annotations
 * fails closed.
 */
export function missingScope(spec: McpTool, caller: ToolContext["caller"]): string | null {
  const scopes = caller.scopes;
  if (!scopes?.length) return null;
  if (spec.annotations?.readOnlyHint === true) return scopes.includes("mcp:read") || scopes.includes("mcp:write") ? null : "mcp:read";
  return scopes.includes("mcp:write") ? null : "mcp:write";
}

/** Runs one tool, turning a role or storage failure into something sayable. */
export async function runTool(spec: McpTool, args: Record<string, never>, ctx: ToolContext): Promise<ToolOutput> {
  const output = await runOnce(spec, args, ctx);
  if (output.isError) await logToolGap(spec, args, ctx, output);
  return output;
}

/**
 * Refusals that are about who is asking, or about asking again, say nothing
 * about what the product can do, so they stay out of the gap log.
 */
const NOT_A_GAP = new Set(["unauthorized", "forbidden", "insufficient_scope", "not-found", "needs-confirm", "stale", "busy", "rate-limited", "decided"]);

async function logToolGap(spec: McpTool, args: Record<string, never>, ctx: ToolContext, output: ToolOutput) {
  const code = typeof output.structured?.code === "string" ? output.structured.code : undefined;
  if (code && NOT_A_GAP.has(code)) return;
  const projectId = (args as Record<string, unknown>).projectId;
  await logGaps([
    {
      source: "mcp-tool",
      tool: spec.name,
      ...(typeof projectId === "string" ? { projectId } : {}),
      ...(ctx.caller.userId ? { userId: ctx.caller.userId } : {}),
      detail: output.text ?? `${spec.name} failed`,
      ...(code ? { code } : {}),
    },
  ]);
}

async function runOnce(spec: McpTool, args: Record<string, never>, ctx: ToolContext): Promise<ToolOutput> {
  const needed = missingScope(spec, ctx.caller);
  if (needed) return refusal(`${spec.name} needs the ${needed} scope, which this connection was not granted. Reconnect the connector and allow it.`, "insufficient_scope");
  try {
    return await spec.run(args, ctx);
  } catch (error) {
    if (error instanceof ServerError) return refusal(error.message, error.code);
    // A file that cannot be read is the file's fault, not a failure of the tool.
    if (error instanceof IngestError) return refusal(error.message, error.code);
    // An unexpected failure must not carry infrastructure detail out to a
    // third party, which is the rule `lib/server/errors.ts` already keeps.
    // The detail does go in the server's own log, which is where it is useful.
    console.error(`[mcp] ${spec.name} failed`, error);
    return refusal(`${spec.name} could not be completed.`, "internal");
  }
}

/**
 * Puts every tool on an `McpServer` for one caller.
 *
 * The registration is typed loosely on purpose. `registerTool` infers the
 * handler's argument type from the schema it is given, which is the right
 * thing when each tool is written out at the call site and an unresolvable
 * instantiation when the schema arrives as an opaque `ZodRawShape` from a
 * table. `spec.ts` keeps the per-tool types where they are worth having -
 * inside `run`, against that tool's own shape - and the SDK has already
 * validated the arguments before the handler is reached.
 */
export function registerTools(server: McpServer, ctx: ToolContext, tools: readonly McpTool[] = TOOLS): void {
  const register = server.registerTool.bind(server) as (name: string, config: Record<string, unknown>, cb: (args: Record<string, never>) => unknown) => unknown;
  for (const spec of tools) {
    register(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.input,
        ...(spec.annotations ? { annotations: spec.annotations } : {}),
        ...(spec.ui ? { _meta: { ui: spec.ui } } : {}),
      },
      async (args) => toolResult(await runTool(spec, args, ctx)),
    );
  }
}
