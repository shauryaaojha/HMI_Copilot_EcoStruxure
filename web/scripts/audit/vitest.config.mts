// The audit's own failing tests: each one proves a bug in docs/audit/BUGS.md and is
// expected to FAIL on the code it was written against. They stay out of web/tests
// (the suite must stay green); Stage 2 moves each one into web/tests with its fix.
//
//   cd web && npx vitest run --config scripts/audit/vitest.config.mts
import { defineConfig } from "vitest/config";
import path from "node:path";

const web = path.resolve(import.meta.dirname, "..", "..");

export default defineConfig({
  root: web,
  test: { environment: "node", include: ["scripts/audit/**/*.test.ts"], testTimeout: 20_000 },
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.join(web, "src") } },
});
