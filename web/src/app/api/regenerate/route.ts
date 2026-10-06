/**
 * Compile one screen again from its recipe, for the regenerate dialog.
 *
 * Returns the fresh screen with stable keys; the client diffs it against the
 * screen as it stands (lib/program/regenerate.ts) and applies only what the
 * engineer accepts. Nothing is changed here - this is the "what would it be
 * now" half, and it is safe to call as often as the dialog likes.
 *
 * Node runtime: the shipped symbols are read from the local graphics index.
 */

import { recompileScreen, type RecompileInput } from "@/lib/program/recompile";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: Partial<RecompileInput>;
  try {
    body = (await request.json()) as Partial<RecompileInput>;
  } catch {
    return Response.json({ error: "expected a JSON body", code: "bad-request" }, { status: 400 });
  }
  if (!body.screenName || !Array.isArray(body.variables) || !Array.isArray(body.screens)) {
    return Response.json({ error: "a regeneration needs the screen name, the tags and the screen list", code: "bad-request" }, { status: 400 });
  }
  if (body.variables.length === 0) {
    return Response.json(
      { error: "There are no tags in this project, so there is nothing to compile the screen from.", code: "no-tags", hint: "Import the tag export first." },
      { status: 422 },
    );
  }
  const panel = body.panel && Number(body.panel.width) > 0 && Number(body.panel.height) > 0 ? { width: Number(body.panel.width), height: Number(body.panel.height) } : { width: 1024, height: 768 };
  try {
    const result = await recompileScreen({
      screenName: body.screenName,
      program: body.program,
      parts: Array.isArray(body.parts) ? body.parts : [],
      screens: body.screens,
      variables: body.variables,
      structure: Array.isArray(body.structure) ? body.structure : undefined,
      panel,
      plant: body.plant,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const ours = /has no recipe/.test(message);
    return Response.json(
      { error: ours ? message : `Could not compile ${body.screenName}: ${message}`, code: ours ? "no-recipe" : "compile-failed" },
      { status: ours ? 422 : 500 },
    );
  }
}
