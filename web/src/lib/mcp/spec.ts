/**
 * What a tool is, in one shape, so that adding one is adding an entry.
 *
 * A tool declares its name, how to describe itself, the zod schema of its
 * arguments, and what it does. The schema is zod on purpose: the `Op` union is
 * already a zod schema (`core/ops/ops.ts`), and handing it straight to the SDK
 * means the JSON schema claude.ai sees is generated from the same definition
 * `applyOps` validates against. A retyped JSON schema would drift the first
 * time an op gained a field.
 *
 * `run` returns plain data (`ToolOutput`), never MCP content. The conversion -
 * the size cap, the `_meta.ui` card for MCP Apps - happens once, in
 * `result.ts`, so no tool can skip either.
 *
 * Streams S6 and S7 extend from here: S6 adds a `generate` entry to the table
 * in `tools.ts`, S7 sets `ui` on an existing tool's output.
 */
import type { ZodRawShape, z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Caller } from "./caller";
import type { ToolOutput } from "./result";

/** What every tool is given: who is calling, and nothing else. */
export interface ToolContext {
  caller: Caller;
}

/** A tool with its argument types erased, which is how the table holds them. */
export interface McpTool {
  name: string;
  title: string;
  description: string;
  annotations?: ToolAnnotations;
  input: ZodRawShape;
  run(args: Record<string, never>, ctx: ToolContext): Promise<ToolOutput>;
}

/**
 * Declares one tool, keeping its arguments typed inside `run` while the table
 * outside stays a plain list. The SDK has already validated `args` against
 * `input` by the time `run` sees them, which is the only reason the cast is
 * sound - and the reason no tool re-parses its own arguments.
 */
export function tool<Shape extends ZodRawShape>(spec: {
  name: string;
  title: string;
  description: string;
  annotations?: ToolAnnotations;
  input: Shape;
  run(args: { [K in keyof Shape]: z.infer<Shape[K]> }, ctx: ToolContext): Promise<ToolOutput>;
}): McpTool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    annotations: spec.annotations,
    input: spec.input,
    run: (args, ctx) => spec.run(args as unknown as { [K in keyof Shape]: z.infer<Shape[K]> }, ctx),
  };
}
