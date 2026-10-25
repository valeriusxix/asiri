import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/test/**/*.test.ts"],
    // Each worker loads better-sqlite3 + the app; cap them so low-memory machines don't fail to fork.
    maxWorkers: 4,
  },
});
