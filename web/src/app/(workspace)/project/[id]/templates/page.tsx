import { PageShell } from "@/components/shell/PageShell";
import { TemplatesScreen } from "@/components/templates/TemplatesScreen";

/** Templates - reference screen 4. Phase 9 of docs/BUILD_PLAN.md. */
export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell
      projectId={id}
      title="Equipment Templates"
      description="Groups of real OTE parts, placed on the active screen."
    >
      <TemplatesScreen projectId={id} />
    </PageShell>
  );
}
