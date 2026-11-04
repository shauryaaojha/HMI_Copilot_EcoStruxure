/**
 * Renders the demo screen to PNG with the server rasteriser, in its own process,
 * so a resvg panic shows as an exit code instead of killing the test worker.
 *
 *   tsx tests/helpers/render-probe.mts <height> [alarmTop]
 */
import { demoScreen } from "@/fixtures";
import { screenToPng } from "@/lib/critic/render";

const [height, alarmTop] = process.argv.slice(2).map(Number);
const screen = structuredClone(demoScreen);
const root = screen.Children[0] as unknown as { Height: number; Children: { Type: string; Location: { Left: number; Top: number } }[] };
root.Height = height;
if (Number.isFinite(alarmTop)) for (const p of root.Children) if (p.Type === "AlarmSummary") p.Location = { ...p.Location, Top: alarmTop };
const png = await screenToPng(screen);
console.log(`png ${png.byteLength}`);
