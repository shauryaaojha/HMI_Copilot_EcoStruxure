/**
 * S3: how big a screen /api/critique's renderOnly path will try to draw, and what happens.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/audit/s3-render-probe.mts <width> <height>
 *
 * Calls the route handler in-process with the tracked demo screen resized, no session. Prints
 * the status and PNG size, or dies with the rasteriser's own panic. Exit code 0 means the
 * process survived. Run it in its own process: a resvg panic takes the whole process down.
 */
import { demoScreen } from "@/fixtures";
import { POST } from "@/app/api/critique/route";

const [w, h] = process.argv.slice(2).map(Number);
const screen = structuredClone(demoScreen);
Object.assign(screen.Children[0], { Width: w, Height: h });
const t = performance.now();
const r = await POST(new Request("http://x/api/critique", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ screen, renderOnly: true }) }));
const bytes = r.status === 200 ? (await r.arrayBuffer()).byteLength : 0;
console.log(`${w}x${h}: HTTP ${r.status}, PNG ${bytes} bytes, ${Math.round(performance.now() - t)} ms, rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
