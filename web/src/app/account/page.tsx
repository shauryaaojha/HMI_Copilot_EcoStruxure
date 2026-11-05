import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/session";
import { AccountSettings } from "@/components/account/AccountSettings";
import { SchneiderMark } from "@/components/shell/SchneiderMark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user?.email) redirect("/signin?next=%2Faccount");
  return <div className="min-h-screen bg-surface-base p-6">
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header className="space-y-2">
        <SchneiderMark className="text-brand-400" />
        <h1 className="text-base font-semibold text-text-primary">Account</h1>
      </header>
      <AccountSettings name={user.name} email={user.email} />
    </div>
  </div>;
}
