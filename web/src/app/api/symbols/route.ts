/**
 * The shipped graphic object library, as indexed from a local installation.
 *
 * Served rather than imported. graphics-index.json is derived from Schneider's
 * own files and is gitignored, so a static import would break the build on any
 * machine without an EcoStruxure installation - which is every machine that did
 * not run `npm run index:graphics`.
 *
 * Phase 2b of docs/BUILD_PLAN.md.
 */

import type { GraphicObject } from "@/lib/ote/graphics";

export const runtime = "nodejs";

let cached: GraphicObject[] | null | undefined;

async function load(): Promise<GraphicObject[] | null> {
  if (cached !== undefined) return cached;

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const file = path.join(process.cwd(), "src", "lib", "ote", "graphics-index.json");

  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as {
      symbols?: GraphicObject[];
    };
    cached = Array.isArray(parsed.symbols) ? parsed.symbols : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function GET() {
  const symbols = await load();

  if (!symbols) {
    // Not an error: a machine without the installation simply has no library,
    // and the Library screen says so rather than showing an empty grid.
    return Response.json({
      symbols: [],
      indexed: false,
      reason: "No symbol index. Run `npm run index:graphics` on a machine with EcoStruxure installed.",
    });
  }

  return Response.json({ symbols, indexed: true });
}
