import { TagsScreen } from "@/components/tags/TagsScreen";

/** Import PLC Tags - reference screen 3. Phase 3 of docs/BUILD_PLAN.md. */
export default async function TagsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TagsScreen projectId={id} />;
}
