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

/** How many clarify answers are read, and how long each may be. */
const ANSWERS = 2;
const LONGEST = 2000;

/** Body `{ intent, answers? }`; answers `{ brief, by, questions? }`. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { intent?: unknown; answers?: unknown } | null;
  const intent = typeof body?.intent === "string" ? body.intent.trim().slice(0, 4000) : "";
  // A clarify answer is more of the description, so it is bounded the same way
  // and read the same way: engineer's text, never instructions to the model.
  const answers = (Array.isArray(body?.answers) ? body.answers : [])
    .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    .slice(0, ANSWERS)
    .map((a) => a.trim().slice(0, LONGEST));
  if (!intent && answers.length === 0) return Response.json({ error: "describe the plant first" }, { status: 400 });
  return Response.json(await draftBrief(intent, { ask: askJson, answers }));
}
