import { defineConfig } from "vitest/config";

// Render tests only (react-dom/server in Node): no browser, no network.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
