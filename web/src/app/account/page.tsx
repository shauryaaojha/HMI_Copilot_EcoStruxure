import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/session";
import { AccountSettings } from "@/components/account/AccountSettings";
import { AccountFrame } from "@/components/account/AccountFrame";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user?.email) redirect("/signin?next=%2Faccount");
  return (
    <AccountFrame title="Account" lead="Your profile, your password, and where you are signed in." tabs="account">
      <AccountSettings name={user.name} email={user.email} />
    </AccountFrame>
  );
}
