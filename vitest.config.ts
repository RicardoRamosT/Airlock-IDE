import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "broker/**/*.test.{ts,tsx}",
    ],
    environment: "node",
  },
});
