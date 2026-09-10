import type { NextConfig } from "next";

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
  serverExternalPackages: ["sql.js"],

  // The project skeleton is read with fs at request time, so it has to be
  // traced into the standalone output or the export route 500s in production.
  outputFileTracingIncludes: {
    "/api/export": ["./skeleton/**/*"],
  },
};

export default config;
