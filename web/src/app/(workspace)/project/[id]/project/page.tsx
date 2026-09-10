import { PageShell } from "@/components/shell/PageShell";
import { ProjectsScreen } from "@/components/projects/ProjectsScreen";

/** Projects - reference screen 2. Phase 9 of docs/BUILD_PLAN.md. */
export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell
      projectId={id}
      title="Projects"
      description="Create a new project or open an existing one."
    >
      <ProjectsScreen />
    </PageShell>
  );
}
