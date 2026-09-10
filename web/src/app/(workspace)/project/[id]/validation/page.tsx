import { PageShell } from "@/components/shell/PageShell";
import { ValidationResults } from "@/components/validation/ValidationResults";

/** Validation Results - reference screen 8. Phase 6 of docs/BUILD_PLAN.md. */
export default async function ValidationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell
      projectId={id}
      title="Validation Results"
      description="Check your project for errors, warnings and improvements."
    >
      <ValidationResults projectId={id} />
    </PageShell>
  );
}
