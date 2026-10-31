import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/session";
import { Connections } from "@/components/account/Connections";
import { SchneiderMark } from "@/components/shell/SchneiderMark";

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
    <div className="min-h-screen bg-surface-base p-6">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-2">
          <SchneiderMark className="text-brand-400" />
          <h1 className="text-base font-semibold text-text-primary">Connections</h1>
          <p className="text-sm text-text-secondary">
            What can reach {user.name}&apos;s projects through the HMI Copilot connector, and how to stop it.
          </p>
        </header>
        <Connections />
      </div>
    </div>
  );
}
