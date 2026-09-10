import { Workspace } from "@/components/shell/Workspace";

/**
 * The main workspace - reference screens 1, 2, 3, 5 and 6.
 *
 *   intent | canvas | inspector
 *   ------ build timeline ------
 *
 * The route resolves the id and nothing else; everything the engineer sees is
 * driven by the store, so a second project needs no second page.
 */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Workspace projectId={id} />;
}
