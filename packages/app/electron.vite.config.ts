import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    // Bundle agent-core from TS source; keep the native module external.
    plugins: [externalizeDepsPlugin({ exclude: ["@airlock/agent-core"] })],
    // An explicit external array here OVERRIDES (does not merge with) the
    // externalizeDepsPlugin's own external list, so every third-party dep that
    // must NOT be bundled is listed here explicitly. node-pty is native;
    // @modelcontextprotocol/sdk must stay external too -- bundling its source
    // into out/main risks an Electron cjs_lexer multibyte crash, and like
    // node-pty it ships fine as an externalized require. The trailing regex
    // covers the deep subpath imports (server/mcp.js, server/streamableHttp.js).
    build: {
      rollupOptions: {
        external: [
          "node-pty",
          // @parcel/watcher is native (an FSEvents .node binary): require it at
          // runtime, never bundle it -- same treatment as node-pty.
          "@parcel/watcher",
          "electron",
          "@modelcontextprotocol/sdk",
          /^@modelcontextprotocol\/sdk\/.+/,
        ],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
