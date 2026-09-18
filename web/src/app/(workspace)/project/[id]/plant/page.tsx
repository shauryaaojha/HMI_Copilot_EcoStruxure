import { PageShell } from "@/components/shell/PageShell";
import { PlantScreen } from "@/components/plant/PlantScreen";

/** The Plant Model: what the screens are projections of. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.1. */
export default async function PlantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageShell
      projectId={id}
      title="Plant"
      description="Areas, units and equipment read from the tag names, with the ranges every indicator uses and the connections the process view follows. Correct it here rather than on forty screens."
    >
      <PlantScreen />
    </PageShell>
  );
}
