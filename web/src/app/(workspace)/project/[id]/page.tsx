import { NavRail } from "@/components/shell/NavRail";
import { TopBar } from "@/components/shell/TopBar";
import { IntentPanel } from "@/components/intent/IntentPanel";
import { CanvasPane } from "@/components/canvas/CanvasPane";
import { Inspector } from "@/components/inspector/Inspector";
import { BuildTimeline } from "@/components/timeline/BuildTimeline";

/**
 * The main workspace - reference screens 1, 2, 3, 5 and 6.
 *
 *   intent | canvas | inspector
 *   ------ build timeline ------
 */
export default async function Workspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <TopBar projectName="Pump_Station_Demo" target="HMIGTO6310 · 1024 × 768" />
      <div className="flex min-h-0 flex-1">
        <NavRail projectId={id} />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <IntentPanel />
            <CanvasPane />
            <Inspector />
          </div>
          <BuildTimeline />
        </div>
      </div>
    </>
  );
}
