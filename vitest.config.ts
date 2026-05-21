import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.local.test.ts"],
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      "server-only": resolve(__dirname, "tests/shims/server-only.ts"),
    },
  },
});
