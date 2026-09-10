import { PageShell } from "@/components/shell/PageShell";
import { HistoryScreen } from "@/components/history/HistoryScreen";

/** Project History - reference screen 10. Phase 9 of docs/BUILD_PLAN.md. */
export default async function HistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell
      projectId={id}
      title="Project History"
      description="Track changes and revert to previous versions."
    >
      <HistoryScreen projectId={id} />
    </PageShell>
  );
}
