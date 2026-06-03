import { describe, expect, it } from "vitest";
import { languageKeyForPath } from "./language";

describe("languageKeyForPath", () => {
  it.each([
    ["src/App.tsx", "js"],
    ["index.js", "js"],
    ["lib/util.mjs", "js"],
    ["package.json", "json"],
    ["README.md", "md"],
    ["theme.css", "css"],
    ["index.html", "html"],
  ])("%s → %s", (path, key) => {
    expect(languageKeyForPath(path)).toBe(key);
  });

  it("returns null for unknown extensions", () => {
    expect(languageKeyForPath("rsa_key.pem")).toBeNull();
    expect(languageKeyForPath("Makefile")).toBeNull();
  });
});
