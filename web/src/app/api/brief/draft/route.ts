/**
 * A plant brief drafted from a description, for review before anything is
 * built (lib/brief, docs/PLAN_FULL_ARCHITECTURE.md §5.3).
 *
 * Answers a brief, never tags. Placeholder tags exist only after the engineer
 * confirms the brief in the browser, which is the whole point of the step: the
 * old route returned tags and the build started on them unseen.
 */
import { askJson } from "@/lib/ai/draft";
import { draftBrief } from "@/lib/brief/draft";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Body `{ intent }`; answers `{ brief, by, questions? }`. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { intent?: unknown } | null;
  const intent = typeof body?.intent === "string" ? body.intent.trim().slice(0, 4000) : "";
  if (!intent) return Response.json({ error: "describe the plant first" }, { status: 400 });
  return Response.json(await draftBrief(intent, { ask: askJson }));
}
