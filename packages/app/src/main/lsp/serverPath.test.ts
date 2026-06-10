import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundledLanguageServerCli } from "./serverPath";

describe("bundledLanguageServerCli", () => {
  // The packaged app must NOT spawn the asar-bundled CLI: the child runs as
  // plain Node (ELECTRON_RUN_AS_NODE), which has no asar support, so importing
  // the ESM cli.mjs from the virtual asar path dies with ERR_MODULE_NOT_FOUND.
  // extraResources ships the dependency-free package as lsp-server/; this
  // resolver prefers that real on-disk copy.
  it("returns the extraResources cli.mjs when it exists under resourcesPath", () => {
    const expected = path.join("/Res", "lsp-server", "lib", "cli.mjs");
    const got = bundledLanguageServerCli("/Res", (p) => p === expected);
    expect(got).toBe(expected);
  });

  it("returns null without a resourcesPath (dev/tests -> require.resolve fallback)", () => {
    expect(bundledLanguageServerCli(undefined, () => true)).toBeNull();
  });

  it("returns null when the bundled file is absent (dev resourcesPath is Electron's own)", () => {
    expect(bundledLanguageServerCli("/Res", () => false)).toBeNull();
  });
});
