import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    // Bundle agent-core from TS source; keep the native module external.
    plugins: [externalizeDepsPlugin({ exclude: ["@airlock/agent-core"] })],
    build: { rollupOptions: { external: ["node-pty", "electron"] } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
