import { PageShell } from "@/components/shell/PageShell";
import { ExportScreen } from "@/components/export/ExportScreen";

/** Generate & Export - reference screen 9. Phase 7 of docs/BUILD_PLAN.md. */
export default async function ExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell
      projectId={id}
      title="Generate & Export"
      description="Create EcoStruxure-compatible files from your project."
    >
      <ExportScreen />
    </PageShell>
  );
}
