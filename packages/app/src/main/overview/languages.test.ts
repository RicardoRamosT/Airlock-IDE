import { expect, it } from "vitest";
import { languageBreakdown } from "./languages";

it("counts by language and sorts by file count descending", () => {
  const out = languageBreakdown([
    "a.ts",
    "b.tsx",
    "c.ts",
    "style.css",
    "main.py",
  ]);
  expect(out).toEqual([
    { id: "typescript", name: "TypeScript", files: 3 },
    // css and python tie at 1 -> alphabetical by name (CSS before Python)
    { id: "css", name: "CSS", files: 1 },
    { id: "python", name: "Python", files: 1 },
  ]);
});

it("folds extra languages and unrecognized extensions into one Other bucket", () => {
  const out = languageBreakdown(
    ["a.ts", "b.ts", "x.bin", "noext", "y.rs", "z.go"],
    1, // keep only the top language
  );
  expect(out[0]).toEqual({ id: "typescript", name: "TypeScript", files: 2 });
  // rust(1) + go(1) beyond topN, plus x.bin + noext unrecognized = 4
  expect(out[out.length - 1]).toEqual({ id: "other", name: "Other", files: 4 });
});

it("returns [] for no files and omits Other when everything is recognized", () => {
  expect(languageBreakdown([])).toEqual([]);
  expect(languageBreakdown(["only.ts"])).toEqual([
    { id: "typescript", name: "TypeScript", files: 1 },
  ]);
});
