/**
 * S2-08 (docs/audit/BUGS.md): every page could be framed by another site and
 * answered X-Powered-By. next.config.ts now sends frame-ancestors 'none',
 * X-Frame-Options and nosniff on every route, and no framework banner.
 */
import { expect, it } from "vitest";
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
});
