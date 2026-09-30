import { describe, expect, it } from "vitest";
import { languageExtensionForPath, languageKeyForPath } from "./language";

describe("languageKeyForPath", () => {
  it.each([
    ["src/App.tsx", "js"],
    ["index.js", "js"],
    ["lib/util.mjs", "js"],
    ["package.json", "json"],
    ["README.md", "md"],
    ["theme.css", "css"],
    ["index.html", "html"],
    ["docker-compose.yml", "yaml"],
    [".github/workflows/ci.YAML", "yaml"],
  ])("%s → %s", (path, key) => {
    expect(languageKeyForPath(path)).toBe(key);
  });

  it("returns null for unknown extensions", () => {
    expect(languageKeyForPath("rsa_key.pem")).toBeNull();
    expect(languageKeyForPath("Makefile")).toBeNull();
  });
});

// YAML rendered as one flat colour because no grammar was bundled -- keys read
// exactly like values (reported 2026-09-30).
it("gives the editor a YAML grammar for .yml / .yaml", () => {
  expect(languageExtensionForPath("docker-compose.yml")).toHaveLength(1);
  expect(languageExtensionForPath("a.yaml")).toHaveLength(1);
});
