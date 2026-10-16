/**
 * The bytes of a picture a ClipArt or Image part names, by SHA-1.
 *
 *   GET /api/picture/<sha1>[?source=<opened project id>]
 *
 * From the installed clipart library first (lib/ote/cliparts.ts), then from
 * the opened project's own `Resources\<sha1>.png`. Content-addressed, so a
 * response never goes stale and is cached as immutable.
 *
 * Node runtime: reads the installation and the stored project.
 */

import { currentUser } from "@/lib/server/session";
import { hasMongo } from "@/lib/db/mongo";
import { readSource } from "@/lib/server/access";
import { shareTokens } from "@/lib/server/shares";
import { errorResponse } from "@/lib/server/errors";
import JSZip from "jszip";
import { cliparts } from "@/lib/ote/cliparts";
import { getImport } from "@/lib/ote/imports";

export const runtime = "nodejs";

const png = (bytes: Uint8Array, privateSource = false) =>
  new Response(Buffer.from(bytes), {
    headers: { "content-type": "image/png", "cache-control": privateSource ? "private, no-store" : "public, max-age=31536000, immutable" },
  });

export async function GET(request: Request, { params }: { params: Promise<{ sha: string }> }) {
  const { sha } = await params;
  if (!/^[0-9a-f]{40}$/i.test(sha)) return new Response("not a picture id", { status: 400 });
  const key = sha.toLowerCase();

  const library = await cliparts();
  const hit = library.bytes.get(key);
  if (hit) return png(hit);

  const source = new URL(request.url).searchParams.get("source");
  if (source) {
    try {
    const stored = (hasMongo() || !process.env.VERCEL) ? await readSource(source, await currentUser(), "read", undefined, shareTokens(request)) : null;
    const bytes = stored?.bytes ?? await getImport(source);
    if (bytes) {
      const zip = await JSZip.loadAsync(bytes);
      const entry = Object.keys(zip.files).find((n) => n.replace(/\\/g, "/").toLowerCase() === `resources/${key}.png`);
      if (entry) return png(await zip.file(entry)!.async("uint8array"), true);
    }
    } catch (error) { return errorResponse(error); }
  }
  return new Response("no such picture here", { status: 404 });
}
