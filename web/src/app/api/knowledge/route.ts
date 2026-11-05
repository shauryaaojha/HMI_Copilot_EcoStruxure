/**
 * The knowledge base: finished projects, scanned for what they teach.
 *
 *   GET                 the store in use, a line per project, and the conventions
 *   GET ?id=<sha256>    one project's full scan
 *   POST <bytes>        scan a project and keep it, without opening it
 *                       (for feeding a library of finished projects in bulk)
 *   DELETE ?id=<sha256> forget one project entirely
 *
 * Opening a project through /api/import also scans it; this route is for the
 * engineer who wants to see, add to, or prune what the tool has learned.
 * Node runtime: sql.js reads the databases.
 *
 * A scan holds a customer's tag names and conventions, so every method needs a
 * signed-in user (the laptop's local identity counts), and the writes refuse
 * another origin (docs/audit/BUGS.md S2-06). Raw scans belong to one owner.
 */

import { fileNameFrom, ingestResponse, IngestError } from "@/lib/ingest/errors";
import { readBody } from "@/lib/ingest/body";
import { refuse, sniff } from "@/lib/ingest/sniff";
import { scanProject, scanVijeo } from "@/lib/knowledge/scan";
import { aggregate } from "@/lib/knowledge/conventions";
import { allKnowledge, deleteKnowledge, getKnowledge, knowledgeStore, ownedBy, ownScan, putKnowledge, summarise } from "@/lib/knowledge/store";
import { errorResponse, sameOrigin, userRequired } from "@/lib/server/http";

/** The caller check, as a response when it fails. */
async function refused(request: Request, write: boolean): Promise<{ id: string } | Response> {
  try {
    if (write) sameOrigin(request);
    return await userRequired();
  } catch (error) {
    return errorResponse(error);
  }
}

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const no = await refused(request, false);
  if (no instanceof Response) return no;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const found = await getKnowledge(id);
      return found && ownedBy(found, no.id) ? Response.json(found) : Response.json({ error: "no such project in the knowledge base", code: "not-found" }, { status: 404 });
    }
    const records = (await allKnowledge()).filter((record) => ownedBy(record, no.id));
    return Response.json({ store: knowledgeStore(), projects: records.map(summarise), conventions: aggregate(records) });
  } catch (error) {
    return ingestResponse(error, "could not read the knowledge base");
  }
}

export async function POST(request: Request) {
  const no = await refused(request, true);
  if (no instanceof Response) return no;
  const fileName = fileNameFrom(request, "project.eote");
  try {
    if (knowledgeStore() === "off") {
      return Response.json(
        {
          error: "The knowledge base is off on this deployment.",
          code: "store-off",
          hint: "Set KNOWLEDGE_STORE=filesystem (or =mongo, deliberately) to keep scanned projects.",
        },
        { status: 409 },
      );
    }
    const bytes = await readBody(request);
    const kind = await sniff(bytes, fileName);
    // The older layout cannot be opened, but it can be learned from: only
    // non-projects are refused here.
    const vdz = kind.kind === "vijeo-designer" && kind.variant === "vdz";
    if (kind.kind !== "ote-project" && !vdz) {
      throw refuse(kind, fileName) ?? new IngestError("unsupported-format", `${fileName} is not an Operator Terminal Expert or Vijeo Designer project.`);
    }
    const knowledge = await ownScan(vdz ? await scanVijeo(bytes, fileName) : await scanProject(bytes, fileName), no.id);
    const kept = await putKnowledge(knowledge);
    return Response.json({ ...kept, summary: summarise(knowledge), problems: knowledge.problems });
  } catch (error) {
    return ingestResponse(error, "could not scan the project");
  }
}

export async function DELETE(request: Request) {
  const no = await refused(request, true);
  if (no instanceof Response) return no;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  try {
    const found = await getKnowledge(id);
    const gone = found && ownedBy(found, no.id) ? await deleteKnowledge(id) : false;
    return gone ? Response.json({ deleted: id }) : Response.json({ error: "no such project in the knowledge base", code: "not-found" }, { status: 404 });
  } catch (error) {
    return ingestResponse(error, "could not delete from the knowledge base");
  }
}
