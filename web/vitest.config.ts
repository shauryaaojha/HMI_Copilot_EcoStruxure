import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // 20 s rather than the default 5: on Windows, file-store and sandbox cases that
  // take 1-2 s alone pass 5 s while the bcrypt sign-in cases run beside them.
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 20_000 },
  // The canvas tests render React components, and tsconfig sets jsx "preserve"
  // for Next's own transform. esbuild needs telling explicitly.
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
