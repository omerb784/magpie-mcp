import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "ui/src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/lifecycle/promotion-e2e.test.ts",
      "src/lifecycle/probe2-stress.test.ts",
      "src/lifecycle/probe3-promotion-race.test.ts",
    ],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
    },
  },
});
