import { PageShell } from "@/components/shell/PageShell";
import { SettingsScreen } from "@/components/settings/SettingsScreen";

/** Settings - reference screens 11 and 12. Phase 9 of docs/BUILD_PLAN.md. */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell
      projectId={id}
      title="Settings"
      description="Configure application preferences."
    >
      <SettingsScreen />
    </PageShell>
  );
}
