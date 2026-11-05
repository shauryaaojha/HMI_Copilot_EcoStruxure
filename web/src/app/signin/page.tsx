import { AuthPage } from "@/components/shell/AuthPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return AuthPage({ mode: "in", next });
}
