/**
 * The agent: one job on an opened project, streamed step by step.
 *
 * POST { source?, project?, message, history? } -> NDJSON, one AgentEvent per line
 * (lib/agent/run.ts). The project file the engineer opened is loaded into a
 * working directory with the same access check the export makes; the agent
 * reads, edits and checks it with its tools. When it changed anything, the
 * result is kept as a new file and the last line is
 * { type: "saved", sourceId, project } - the project read back the way
 * /api/import reads one, so the UI opens it in place. The opened file itself
 * is never changed.
 *
 * `project` is the project as the app holds it now (what /api/export takes).
 * With it, the agent works on that: the opened file with every change made in
 * the app since, or a project built here with no file at all. Without it, on
 * the file as it was opened - and a save from there would drop the app's
 * changes, which is why the pane always sends it.
 */

import { modelCaller } from "@/lib/server/model-gate";
import { runAgent, type AgentTurn } from "@/lib/agent/run";
import { chooseModel } from "@/lib/ai/menu";
import { Workspace } from "@/lib/agent/workspace";
import { hasMongo } from "@/lib/db/mongo";
import { getImport, importStore, putImport } from "@/lib/ote/imports";
import { readProject } from "@/lib/ote/reader";
import { readSource } from "@/lib/server/access";
import { ServerError } from "@/lib/server/errors";
import { errorResponse, sameOrigin, json } from "@/lib/server/http";
import { repo } from "@/lib/server/repo";
import { currentUser } from "@/lib/server/session";
import { shareTokens } from "@/lib/server/shares";
import { backendFor } from "@/lib/backend";
import { preflight } from "@/lib/ote/preflight";
import type { PackageInput } from "@/lib/ote/packager";

/** The project as the app holds it, written as the export writes it: into its own file when it has one. */
async function liveBytes(input: PackageInput & { source?: string }, request: Request, user: Awaited<ReturnType<typeof currentUser>>) {
  const problems = preflight(input);
  if (problems.length) throw new Error(`the project has ${problems.length} problem${problems.length === 1 ? "" : "s"} to fix first: ${problems.slice(0, 3).map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ")}`);
  const backend = backendFor("eote");
  if (input.source && /^[0-9a-f-]{36}$/i.test(input.source)) {
    const stored = hasMongo() || !process.env.VERCEL ? await readSource(input.source, user, "read", undefined, shareTokens(request)).catch(() => null) : null;
    const original = stored?.bytes ?? (await getImport(input.source));
    if (original) {
      const read = await readProject(original);
      return { bytes: await backend.write(input, read.preserved), fileName: stored?.meta.fileName ?? `${safeName(input.name)}.eote` };
    }
  }
  return { bytes: await backend.write(input), fileName: `${safeName(input.name)}.eote` };
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "project";

export const runtime = "nodejs";
/** A job is many model calls; the plan's Function limit, not one call's. */
export const maxDuration = 300;

interface Body {
  source?: string;
  /** The project as the app holds it now, as /api/export takes it. */
  project?: PackageInput & { source?: string };
  message?: string;
  history?: AgentTurn[];
  /** A menu id from /api/provider (lib/ai/menu.ts); unknown or absent means the default. */
  model?: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    sameOrigin(request);
    await modelCaller();
  } catch (e) {
    return errorResponse(e as ServerError);
  }
  try {
    body = (await json(request)) as Body;
  } catch (e) {
    return errorResponse(e);
  }
  const { source, message, project } = body;
  const live = project && Array.isArray(project.screens) && project.screens.length > 0;
  if (!live && (!source || !/^[0-9a-f-]{36}$/i.test(source))) return Response.json({ error: "open or build a project first: the agent works on it" }, { status: 400 });
  if (!message?.trim()) return Response.json({ error: "say what the agent should do" }, { status: 400 });

  const user = await currentUser();
  let bytes: Uint8Array | null;
  let fileName: string;
  if (live) {
    try {
      ({ bytes, fileName } = await liveBytes(project, request, user));
    } catch (e) {
      return Response.json({ error: `the project could not be written for the agent: ${(e as Error).message}` }, { status: 422 });
    }
  } else {
    const stored = hasMongo() || !process.env.VERCEL ? await readSource(source!, user, "read", undefined, shareTokens(request)).catch(() => null) : null;
    bytes = stored?.bytes ?? (await getImport(source!));
    fileName = stored?.meta.fileName ?? "project.eote";
  }
  if (!bytes) return Response.json({ error: "that project file is gone or not yours; open it again" }, { status: 404 });

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
        const picked = chooseModel(body.model);
        const choice = picked.provider && picked.model ? { provider: picked.provider, model: picked.model } : undefined;
        for await (const event of runAgent({ ws, instruction: message, history, signal: request.signal, choice })) {
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
