import type { NextConfig } from "next";

const config: NextConfig = {
  // sql.js ships a .wasm file that webpack must not try to bundle as a module.
  // The packager route runs on the Node runtime and loads it from disk instead.
  serverExternalPackages: ["sql.js"],
};

export default config;
