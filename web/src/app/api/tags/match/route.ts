/**
 * The real tag for each placeholder, once the export arrives in a project
 * whose screens were drawn first (lib/ai/draft.ts). The client renames what
 * matched and reports what did not.
 */
import { matchTags } from "@/lib/ai/draft";
import { Variable } from "@/lib/ote/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Only well-formed variables, and not so many that the request is a mistake. */
function variablesOf(value: unknown, limit: number): Variable[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const parsed = value.map((v) => Variable.safeParse(v));
  return parsed.every((p) => p.success) ? parsed.map((p) => p.data!) : null;
}

/** Body `{ placeholders, variables }`; answers `{ renames, by }`. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { placeholders?: unknown; variables?: unknown } | null;
  const placeholders = variablesOf(body?.placeholders, 2000);
  const variables = variablesOf(body?.variables, 20000);
  if (!placeholders || !variables) return Response.json({ error: "expected two lists of variables" }, { status: 400 });
  return Response.json(await matchTags(placeholders, variables));
}
