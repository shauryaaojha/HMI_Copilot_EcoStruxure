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
import { ServerError } from "@/lib/server/errors";
import { GENERATE_TOOLS } from "./generate";
import { READ_TOOLS } from "./read";
import { refusal, toolResult, type ToolOutput } from "./result";
import type { McpTool, ToolContext } from "./spec";
import { WRITE_TOOLS } from "./write";

export const TOOLS: readonly McpTool[] = [...READ_TOOLS, ...WRITE_TOOLS, ...GENERATE_TOOLS];

/** Runs one tool, turning a role or storage failure into something sayable. */
export async function runTool(spec: McpTool, args: Record<string, never>, ctx: ToolContext): Promise<ToolOutput> {
  try {
    return await spec.run(args, ctx);
  } catch (error) {
    if (error instanceof ServerError) return refusal(error.message, error.code);
    // An unexpected failure must not carry infrastructure detail out to a
    // third party, which is the rule `lib/server/errors.ts` already keeps.
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
