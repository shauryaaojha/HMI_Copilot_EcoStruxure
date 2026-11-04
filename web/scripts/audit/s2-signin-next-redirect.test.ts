/**
 * S2-01: /signin?next= is meant to allow only a path on this site
 * (src/app/signin/page.tsx safeNext). A backslash or a tab after the first
 * slash passes the check, and a browser resolves both to another host.
 * Proved on production read-only: GET /signin?next=/%5Cevil.example renders
 * the form with next "/\\evil.example", which SignInForm passes to
 * window.location.assign after a successful sign-in.
 */
import { expect, it, vi } from "vitest";

vi.mock("@/lib/server/session", () => ({
  currentUser: async () => ({ id: "user:signed-in", name: "Signed in" }),
  providers: () => ["credentials"],
}));
vi.mock("@/components/shell/SignInForm", () => ({ SignInForm: () => null }));
vi.mock("@/components/shell/SchneiderMark", () => ({ SchneiderMark: () => null }));

import SignInPage from "@/app/signin/page";

const SITE = "https://hmibuildtimecopilot.vercel.app";

async function redirectTarget(next: string): Promise<string> {
  try {
    await SignInPage({ searchParams: Promise.resolve({ next }) });
  } catch (error) {
    // next/navigation's redirect() throws; the target is in its digest.
    const digest = String((error as { digest?: string }).digest ?? "");
    return digest.split(";")[2] ?? digest;
  }
  throw new Error("expected a redirect for a signed-in visitor");
}

for (const next of ["/\\evil.example", "/\t/evil.example"]) {
  it(`keeps next=${JSON.stringify(next)} on this site`, async () => {
    const target = await redirectTarget(next);
    const resolved = new URL(target, SITE);
    expect(resolved.origin, `next=${JSON.stringify(next)} redirected to ${resolved.href}`).toBe(SITE);
  });
}
