import { existsSync } from "node:fs";
import path from "node:path";

// Resolve the typescript-language-server CLI shipped via extraResources
// (to: lsp-server), or null when it isn't there (dev/tests, where the caller
// falls back to require.resolve on the real on-disk node_modules).
//
// Why it must exist: in the packaged app the node_modules copy of the CLI
// lives INSIDE app.asar, and the LSP child runs as plain Node
// (ELECTRON_RUN_AS_NODE) with NO asar support -- importing the ESM cli.mjs
// from the virtual asar path dies with ERR_MODULE_NOT_FOUND, seen only by
// proc.on("error"), so LSP silently never works packaged while passing in dev
// and in tests. The package is dependency-free (one bundled cli.mjs importing
// node built-ins only), so the extraResources copy runs standalone -- same
// pattern as ts-lib/tsserver in client.ts.
export function bundledLanguageServerCli(
  resourcesPath: string | undefined,
  exists: (p: string) => boolean = existsSync,
): string | null {
  if (!resourcesPath) return null;
  const bundled = path.join(resourcesPath, "lsp-server", "lib", "cli.mjs");
  return exists(bundled) ? bundled : null;
}
