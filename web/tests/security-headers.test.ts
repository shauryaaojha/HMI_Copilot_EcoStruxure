/**
 * S2-08 (docs/audit/BUGS.md): every page could be framed by another site and
 * answered X-Powered-By. next.config.ts now sends frame-ancestors 'none',
 * X-Frame-Options and nosniff on every route, and no framework banner.
 */
import { afterEach, expect, it, vi } from "vitest";
import config from "../next.config";

it("every route is sent the framing and sniffing headers, without X-Powered-By", async () => {
  expect(config.poweredByHeader).toBe(false);
  const rules = (await config.headers?.()) ?? [];
  const all = rules.find((r) => r.source === "/:path*");
  const sent = Object.fromEntries((all?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
  expect(sent).toMatchObject({
    "content-security-policy": expect.stringContaining("frame-ancestors 'none'"),
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
  });
  const policy = sent["content-security-policy"];
  for (const directive of ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "object-src 'none'", "frame-src 'none'"]) {
    expect(policy).toContain(directive);
  }
});

afterEach(() => vi.unstubAllEnvs());

it("allows only the configured Realtime HTTP and websocket origins", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://realtime.example.com/subpath");
  const rules = (await config.headers?.()) ?? [];
  const policy = rules.find(rule => rule.source === "/:path*")?.headers.find(header => header.key === "Content-Security-Policy")?.value;
  expect(policy).toContain("connect-src 'self' https://realtime.example.com wss://realtime.example.com");
  expect(policy).not.toContain("https://*.supabase.co");
});

it("lets the OAuth consent form redirect to a connector, and nothing else leave the site", async () => {
  const rules = (await config.headers?.()) ?? [];
  const policyOf = (source: string) => rules.find(rule => rule.source === source)?.headers.find(header => header.key === "Content-Security-Policy")?.value ?? "";
  expect(policyOf("/:path*")).toContain("form-action 'self';");
  expect(policyOf("/oauth/:path*")).toContain("form-action 'self' https: http://localhost:* http://127.0.0.1:*;");
  expect(policyOf("/oauth/:path*")).toContain("frame-ancestors 'none'");
  // Next gives the last matching rule's value, so the narrower rule must come after.
  expect(rules.findIndex(rule => rule.source === "/oauth/:path*")).toBeGreaterThan(rules.findIndex(rule => rule.source === "/:path*"));
});

it("sign out everywhere refuses a cross-origin request", async () => {
  const { DELETE } = await import("@/app/api/account/sessions/route");
  const response = await DELETE(new Request("https://app.test/api/account/sessions", { method: "DELETE", headers: { origin: "https://evil.test" } }));
  expect(response.status).toBe(403);
});
