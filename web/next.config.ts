import type { NextConfig } from "next";

const config: NextConfig = {
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
