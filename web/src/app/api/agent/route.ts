/**
 * The agent: one job on an opened project, streamed step by step.
 *
 * POST { source, message, history? } -> NDJSON, one AgentEvent per line
 * (lib/agent/run.ts). The project file the engineer opened is loaded into a
 * working directory with the same access check the export makes; the agent
 * reads, edits and checks it with its tools. When it changed anything, the
 * result is kept as a new file and the last line is
 * { type: "saved", sourceId, project } - the project read back the way
 * /api/import reads one, so the UI opens it in place. The opened file itself
 * is never changed.
 */

import { runAgent, type AgentTurn } from "@/lib/agent/run";
import { Workspace } from "@/lib/agent/workspace";
import { hasMongo } from "@/lib/db/mongo";
import { getImport, importStore, putImport } from "@/lib/ote/imports";
import { readProject } from "@/lib/ote/reader";
import { readSource } from "@/lib/server/access";
import { ServerError } from "@/lib/server/errors";
import { errorResponse, sameOrigin } from "@/lib/server/http";
import { repo } from "@/lib/server/repo";
import { currentUser } from "@/lib/server/session";
import { shareTokens } from "@/lib/server/shares";

export const runtime = "nodejs";
/** A job is many model calls; the plan's Function limit, not one call's. */
export const maxDuration = 300;

interface Body {
  source?: string;
  message?: string;
  history?: AgentTurn[];
}

export async function POST(request: Request) {
  let body: Body;
  try {
    sameOrigin(request);
  } catch (e) {
    return errorResponse(e as ServerError);
  }
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const { source, message } = body;
  if (!source || !/^[0-9a-f-]{36}$/i.test(source)) return Response.json({ error: "open a project file first: the agent works on its file" }, { status: 400 });
  if (!message?.trim()) return Response.json({ error: "say what the agent should do" }, { status: 400 });

  const user = await currentUser();
  const stored = hasMongo() || !process.env.VERCEL ? await readSource(source, user, "read", undefined, shareTokens(request)).catch(() => null) : null;
  const bytes = stored?.bytes ?? (await getImport(source));
  if (!bytes) return Response.json({ error: "that project file is gone or not yours; open it again" }, { status: 404 });
  const fileName = stored?.meta.fileName ?? "project.eote";

  let ws: Workspace;
  try {
    ws = await Workspace.open(bytes, fileName);
  } catch (e) {
    return Response.json({ error: `the file could not be opened: ${(e as Error).message}` }, { status: 422 });
  }

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .slice(-12)
    .map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runAgent({ ws, instruction: message, history, signal: request.signal })) {
          send(event);
          if (event.type !== "done" || !event.changes.length) continue;
          const out = await ws.toBytes();
          const id = user ? await repo().sources.put(out, fileName, user.id) : await putImport(out, fileName);
          const read = await readProject(out, fileName);
          send({
            type: "saved",
            sourceId: id,
            permanent: !!user,
            store: importStore(),
            project: {
              source: id,
              sourceId: id,
              name: read.name,
              target: read.target,
              screens: read.screens,
              foreign: read.foreign,
              variables: read.variables,
              alarms: read.alarms,
              bindings: read.wires.map((w) => ({
                tag: w.tag,
                targetId: w.part.UniqueId,
                targetName: w.part.Name,
                property: w.property,
                ...(w.converter ? { converter: w.converter } : {}),
              })),
              carried: read.carried,
              warnings: read.warnings,
            },
          });
        }
      } catch (e) {
        if (!request.signal.aborted) send({ type: "error", message: (e as Error).message.slice(0, 300) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
