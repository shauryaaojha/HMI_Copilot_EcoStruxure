import type { NextConfig } from "next";

const WASM = "./node_modules/sql.js/dist/sql-wasm.wasm";

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
  serverExternalPackages: ["sql.js", "@resvg/resvg-js", "react-dom/server", "mongodb"],

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
  outputFileTracingIncludes: {
    "/api/export": ["./skeleton/**/*", WASM],
    "/api/export/report": [WASM],
    "/api/import": [WASM],
    "/api/import/screens": [WASM],
    "/api/panel": ["./skeleton/**/*", WASM],
    "/api/validate": [WASM],
    "/api/critique": [WASM],
  },
};

export default config;
