import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    // Compile-time gate for the local dev self-update path. false in release
    // (dead-code-eliminated); true only under `npm run package:dev`.
    define: {
      __AIRLOCK_DEV_UPDATE__: JSON.stringify(
        process.env.AIRLOCK_DEV_UPDATE === "1",
      ),
    },
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
        // TWO main-process entries. atlasDbHost is forked as a utilityProcess
        // and owns the Atlas SQLite handle, so a Node CHECK inside a bind
        // aborts that process instead of the whole IDE. It must be built here
        // rather than shipped as a loose script: it imports the real store
        // code, and duplicating the SQL would be worse than the crash.
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          atlasDbHost: resolve(__dirname, "src/main/atlas/dbHost.ts"),
        },
        external: [
          "node-pty",
          // @parcel/watcher is native (an FSEvents .node binary): require it at
          // runtime, never bundle it -- same treatment as node-pty.
          "@parcel/watcher",
          "electron",
          "@modelcontextprotocol/sdk",
          /^@modelcontextprotocol\/sdk\/.+/,
        ],
        // Adding `input` above replaces electron-vite's single-entry lib
        // config, and with it the CJS default -- rollup then emits ESM
        // `index.mjs` while package.json still points at `out/main/index.js`,
        // i.e. an app that does not start. The output shape is therefore
        // pinned here to exactly what the single-entry build produced.
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name].js",
          // Keeps the native keyring binary flat and unhashed, where it was.
          assetFileNames: "[name].[ext]",
        },
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
