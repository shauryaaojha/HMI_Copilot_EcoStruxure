import { PageShell } from "@/components/shell/PageShell";
import { StandardsScreen } from "@/components/standards/StandardsScreen";

/** Engineering Standards - reference screen 5. Phase 9 of docs/BUILD_PLAN.md. */
export default async function StandardsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell
      projectId={id}
      title="Engineering Standards"
      description="Configure company standards for consistent HMIs."
    >
      <StandardsScreen />
    </PageShell>
  );
}
