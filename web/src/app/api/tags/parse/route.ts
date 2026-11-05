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

import { errorResponse } from "@/lib/server/http";
import { ServerError } from "@/lib/server/errors";
import { uploadedFile } from "@/lib/server/uploads";
import { parseTagsFile } from "@/lib/tags/parse";
import { ingestResponse } from "@/lib/ingest/errors";

export const runtime = "nodejs";

/** A tag export big enough to be a mistake rather than a project. */
const MAX_BYTES = 16 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    // A list too big for one request body comes by the upload parts instead.
    const uploaded = await uploadedFile(request);
    const form = uploaded ? null : await request.formData().catch(() => null);
    const file = form?.get("file");

    if (!uploaded && !(file instanceof File)) {
      return Response.json(
        { error: "expected multipart/form-data with a 'file' field, or JSON with an uploadId" },
        { status: 400 },
      );
    }
    const size = uploaded?.bytes.length ?? (file as File).size;
    if (size > MAX_BYTES) {
      return Response.json(
        { error: `file is ${(size / 1e6).toFixed(1)} MB; the limit is 16 MB` },
        { status: 413 },
      );
    }

    const result = await parseTagsFile(
      uploaded?.bytes ?? await (file as File).arrayBuffer(),
      uploaded?.fileName ?? (file as File).name,
    );
    if (result.variables.length === 0) {
      return Response.json(
        {
          error:
            "no tags found. Expected a column named Name, TagName, Symbol or Variable, or a Control Expert variable export.",
          skipped: result.skipped,
        },
        { status: 422 },
      );
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof ServerError) return errorResponse(error);
    return ingestResponse(error, "could not parse the tag file");
  }
}
