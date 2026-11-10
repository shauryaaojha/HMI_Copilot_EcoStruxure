import { ConnectorSetup } from "@/components/account/ConnectorSetup";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/session";
import { Connections } from "@/components/account/Connections";
import { AccountFrame } from "@/components/account/AccountFrame";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Account connections, outside the project shell on purpose: this is about the
 * account rather than a project, and arriving here from the consent screen or
 * from a Claude error message means arriving without a project in hand.
 */
export default async function ConnectionsPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?next=%2Faccount%2Fconnections");
  return (
    <AccountFrame
      title="Connections"
      lead={<>What can reach {user.name}&apos;s projects through the HMI Copilot connector, and how to stop it.</>}
      tabs="connections"
    >
      <ConnectorSetup />
      <Connections />
    </AccountFrame>
  );
}
