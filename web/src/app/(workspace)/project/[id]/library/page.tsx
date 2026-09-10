import { PageShell } from "@/components/shell/PageShell";
import { LibraryScreen } from "@/components/library/LibraryScreen";

/** Graphic object library - reference screen 4. Phase 2b of docs/BUILD_PLAN.md. */
export default async function LibraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell
      projectId={id}
      title="Graphic Object Library"
      description="The symbols the product ships, indexed from a local installation."
    >
      <LibraryScreen />
    </PageShell>
  );
}
