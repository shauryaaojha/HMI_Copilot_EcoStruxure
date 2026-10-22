/**
 * Placeholder tags for a described plant, for the screens-first workflow:
 * the generator reads equipment from tag names, so screens drawn before the
 * export exists are drawn against these (lib/ai/draft.ts).
 */
import { draftTags } from "@/lib/ai/draft";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Body `{ intent }`; answers `{ variables, by }`, by "model" or "rules". */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { intent?: unknown } | null;
  const intent = typeof body?.intent === "string" ? body.intent.trim().slice(0, 4000) : "";
  if (!intent) return Response.json({ error: "describe the plant first" }, { status: 400 });
  return Response.json(await draftTags(intent));
}
