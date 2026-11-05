import { AuthPage } from "@/components/shell/AuthPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return AuthPage({ mode: "up", next });
}
