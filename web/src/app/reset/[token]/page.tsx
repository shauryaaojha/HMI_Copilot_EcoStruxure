import { SchneiderMark } from "@/components/shell/SchneiderMark";
import { ResetPasswordForm } from "@/components/account/ResetPasswordForm";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <div className="flex min-h-screen items-center justify-center bg-surface-base p-6">
    <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface-float p-6" style={{ boxShadow: "var(--elev-2)" }}>
      <SchneiderMark className="text-brand-400" />
      <h1 className="text-base font-semibold text-text-primary">Reset password</h1>
      <p className="text-sm text-text-secondary">Use the one-time link your installation operator gave you. This page does not check whether an email address has an account.</p>
      <ResetPasswordForm token={token} />
    </div>
  </div>;
}
