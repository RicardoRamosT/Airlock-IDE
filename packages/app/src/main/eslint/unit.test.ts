import { describe, expect, it } from "vitest";
import { eslintInstalled, findEslintUnit, isLintablePath } from "./unit";

const fs =
  (...files: string[]) =>
  (p: string) =>
    files.includes(p);

describe("isLintablePath", () => {
  it("covers the JS/TS family only", () => {
    for (const p of [
      "a.ts",
      "a.tsx",
      "a.mts",
      "a.cts",
      "a.js",
      "a.jsx",
      "a.mjs",
      "a.cjs",
    ])
      expect(isLintablePath(`src/${p}`)).toBe(true);
    for (const p of ["a.md", "a.yml", "a.json", "a.d", "Makefile", ".eslintrc"])
      expect(isLintablePath(p)).toBe(false);
  });
});

describe("findEslintUnit", () => {
  it("finds a root config", () => {
    expect(findEslintUnit("src/a.ts", fs("eslint.config.js"))).toBe("");
  });
  it("prefers the NEAREST config (subfolder units, ezlis-style)", () => {
    const e = fs("eslint.config.js", "client/eslint.config.mjs");
    expect(findEslintUnit("client/src/a.tsx", e)).toBe("client");
    expect(findEslintUnit("server/a.ts", e)).toBe("");
  });
  it("accepts every flat-config extension", () => {
    for (const ext of ["js", "mjs", "cjs", "ts", "mts", "cts"])
      expect(findEslintUnit("a.ts", fs(`eslint.config.${ext}`))).toBe("");
  });
  it("returns null when no config is at or above the file", () => {
    expect(
      findEslintUnit("server/a.ts", fs("client/eslint.config.js")),
    ).toBeNull();
  });
  it("ignores legacy .eslintrc (out of scope)", () => {
    expect(findEslintUnit("a.ts", fs(".eslintrc.json"))).toBeNull();
  });
});

describe("eslintInstalled", () => {
  it("finds eslint beside the config", () => {
    expect(
      eslintInstalled(
        "frontend",
        fs("frontend/node_modules/eslint/package.json"),
      ),
    ).toBe(true);
  });
  it("finds a HOISTED install in an ancestor up to the root", () => {
    expect(
      eslintInstalled("packages/web", fs("node_modules/eslint/package.json")),
    ).toBe(true);
  });
  it("is false when nothing is installed", () => {
    expect(eslintInstalled("frontend", fs())).toBe(false);
  });
});
