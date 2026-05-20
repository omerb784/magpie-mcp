import { defineConfig } from "vitest/config";

// Lifecycle e2e tests spawn real Node child processes (src/index.ts) against tmp
// $MAGPIE_HOME directories and SIGKILL them mid-flight. Run them serially in
// forks pool so SQLite WAL/-shm handle teardown doesn't race with sibling tests
// for the same tmpdir, and so each e2e gets its own clean Node process.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: [
      "src/lifecycle/promotion-e2e.test.ts",
      "src/lifecycle/probe2-stress.test.ts",
      "src/lifecycle/probe3-promotion-race.test.ts",
      "test/e2e/**/*.test.ts",
    ],
    setupFiles: ["./vitest.setup.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
