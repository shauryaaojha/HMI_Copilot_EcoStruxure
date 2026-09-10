/**
 * PLC tag export -> normalised variables.
 *
 * Accepts an OTE variable export (.csv / .txt), a spreadsheet (.xlsx) or a
 * generic tag list. Corrections are returned alongside the variables rather
 * than applied silently - an import that quietly drops bad rows is the
 * behaviour this replaces.
 *
 * Phase 3 of docs/BUILD_PLAN.md.
 */

import { parseTags } from "@/lib/tags/parse";

export const runtime = "nodejs";

/** A tag export big enough to be a mistake rather than a project. */
const MAX_BYTES = 16 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return Response.json(
      { error: "expected multipart/form-data with a 'file' field" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `file is ${(file.size / 1e6).toFixed(1)} MB; the limit is 16 MB` },
      { status: 413 },
    );
  }

  try {
    const result = parseTags(await file.arrayBuffer(), file.name);
    if (result.variables.length === 0) {
      return Response.json(
        {
          error:
            "no tags found. Expected a column named Name, TagName, Symbol or Variable.",
          skipped: result.skipped,
        },
        { status: 422 },
      );
    }
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "could not parse the file" },
      { status: 422 },
    );
  }
}
