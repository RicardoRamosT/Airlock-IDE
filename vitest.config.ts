import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}", "broker/**/*.test.{ts,tsx}"],
    environment: "node",
  },
  resolve: {
    alias: {
      // Unit tests must not depend on the Electron BINARY being present. Under plain
      // Node the real `electron` package resolves to the binary's PATH (not the APIs)
      // and THROWS when that download is missing -- which is how CI failed on two
      // main-process suites. Since the destructured members were already undefined
      // under test, stubbing loses no fidelity. See test/electron-stub.ts.
      electron: fileURLToPath(
        new URL("./test/electron-stub.ts", import.meta.url),
      ),
    },
  },
});
