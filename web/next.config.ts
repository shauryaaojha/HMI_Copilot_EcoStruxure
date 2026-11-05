import type { NextConfig } from "next";

const WASM = "./node_modules/sql.js/dist/sql-wasm.wasm";
// The rasteriser's font (lib/critic/render.ts): a function has no system fonts.
const FONT = "./fonts/*.ttf";

function contentSecurityPolicy(formAction = "'self'"): string {
  const connect = ["'self'"];
  const realtime = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (realtime) {
    try {
      const url = new URL(realtime);
      if (url.protocol === "https:" || url.protocol === "http:") {
        connect.push(url.origin, `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`);
      }
    } catch { /* An invalid Realtime URL cannot authorize another origin. */ }
  }
  if (process.env.NODE_ENV === "development") connect.push("ws:");
  return [
    "default-src 'self'",
    // Next emits inline hydration scripts. Nonces would make every static page
    // dynamic, so production allows inline scripts; this weakens XSS defense.
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${formAction}`,
    "frame-src 'none'",
    // MCP Apps cards are ui:// resources rendered by the host in its own
    // sandbox. Their empty connect/resource domains are in lib/mcp/cards.ts.
    "frame-ancestors 'none'",
  ].join("; ");
}

const config: NextConfig = {
  /**
   * Build somewhere else when asked to.
   *
   * `next dev` and `next build` share .next, so building while a dev server is
   * up replaces the chunks it is serving and the running app starts answering
   * 500 for routes it had already compiled. Set NEXT_DIST_DIR to verify a
   * production build without taking the dev server down:
   *
   *     NEXT_DIST_DIR=.next-build npx next build
   *
   * Next rewrites next-env.d.ts to point at whichever dist dir it built into,
   * so that one file comes back dirty afterwards. Put it back:
   *
   *     git checkout -- next-env.d.ts tsconfig.json
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // sql.js ships a .wasm that webpack must not try to bundle as a module; the
  // packager loads it from disk on the Node runtime instead.
  // The same for resvg, whose renderer is a native binary; and for
  // react-dom/server, which the critic uses to draw a screen headlessly and
  // which the bundler refuses in any graph it might ship to a browser.
  // mongodb pulls optional native add-ons (kerberos, encryption, snappy) that
  // the bundler cannot resolve and does not need; leaving it external keeps the
  // driver on Node's own require.
  // quickjs-emscripten (the agent's script sandbox, lib/agent/script.ts) loads
  // its engine as WebAssembly the same way.
  serverExternalPackages: ["sql.js", "@resvg/resvg-js", "react-dom/server", "mongodb", "quickjs-emscripten", "quickjs-emscripten-core", "@jitl/quickjs-wasmfile-release-sync"],

  /**
   * Files read from disk at request time, which the bundler therefore cannot
   * see and will not carry into the serverless output.
   *
   * sql.js is in serverExternalPackages, so it is required from node_modules at
   * run time - but its WebAssembly is opened by path, not imported, so nothing
   * statically references it and tracing leaves it behind. The deployed
   * function then fails with "sql-wasm.wasm not found. Looked in:
   * /var/task/web/node_modules/sql.js/dist/sql-wasm.wasm", which is exactly
   * where it should have been. Every route that opens a database needs it.
   *
   * The skeleton is the same shape of problem, for the routes that write or
   * read a project.
   */
  /**
   * The two discovery documents, at the paths the specifications fix.
   *
   * A rewrite rather than an `app/.well-known/` directory: a leading dot is
   * not a path segment Next's router is willing to own, and this is one place
   * where getting the URL slightly wrong is indistinguishable from the
   * connector not working - Claude reads
   * /.well-known/oauth-protected-resource and nothing else
   * (docs/CONNECTOR_SPEC_NOTES.md §3).
   *
   * The `:path*` forms are there because RFC 9728 derives the metadata URL by
   * inserting the resource's own path, so a client may ask for
   * /.well-known/oauth-protected-resource/api/mcp. Both spellings answer the
   * same document, which is correct: there is one resource here.
   */
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/authorization-server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/authorization-server" },
    ];
  },

  outputFileTracingIncludes: {
    "/api/export": ["./skeleton/**/*", WASM],
    "/api/export/report": [WASM],
    "/api/import": [WASM],
    "/api/import/screens": [WASM],
    "/api/panel": ["./skeleton/**/*", WASM],
    "/api/validate": [WASM],
    "/api/critique": [WASM, FONT],
    // The connector's validate and generate tools reach the packager and the
    // pipeline, which open databases the same way.
    "/api/mcp": [WASM, FONT],
    // The agent opens databases, writes bindings through the packager and runs
    // scripts in QuickJS, whose engine is a .wasm beside its module.
    "/api/agent": ["./skeleton/**/*", WASM, FONT, "./node_modules/@jitl/quickjs-wasmfile-release-sync/dist/*.wasm"],
  },

  // No framework banner, and no page of this app inside another site's frame
  // or sniffed into another type (docs/audit/BUGS.md S2-08).
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }, {
      // The consent form posts here and the answer redirects to the connector's
      // own callback. Chrome applies form-action to that redirect, so 'self'
      // alone would stop claude.ai from ever receiving its code. These are the
      // redirect URIs oauth.ts accepts. A later rule's value wins in Next.
      source: "/oauth/:path*",
      headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy("'self' https: http://localhost:* http://127.0.0.1:*") }],
    }];
  },
};

export default config;
