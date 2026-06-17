import { expect, it } from "vitest";
import {
  findPathCandidates,
  linksForRows,
  type PathCandidate,
  resolveRel,
} from "./terminalLinks";

// Convenience: the substring a candidate's start..end range covers.
const span = (line: string, c: { start: number; end: number }) =>
  line.slice(c.start, c.end + 1);
// The sole candidate on a line (asserts exactly one).
function first(line: string): PathCandidate {
  const cs = findPathCandidates(line);
  expect(cs).toHaveLength(1);
  const c = cs[0];
  if (!c) throw new Error("no candidate");
  return c;
}

it("finds a relative path with subdirectories", () => {
  const line = "wrote docs/superpowers/specs/foo.md ok";
  const c = first(line);
  expect(c.path).toBe("docs/superpowers/specs/foo.md");
  expect(span(line, c)).toBe("docs/superpowers/specs/foo.md");
  expect(c.line).toBeUndefined();
});

it("parses a :line suffix and includes it in the range", () => {
  const line = "at foo.ts:42 here";
  const c = first(line);
  expect(c.path).toBe("foo.ts");
  expect(c.line).toBe(42);
  expect(c.col).toBeUndefined();
  expect(span(line, c)).toBe("foo.ts:42");
});

it("parses a :line:col suffix", () => {
  const c = first("src/a.ts:12:5:");
  expect(c.path).toBe("src/a.ts");
  expect(c.line).toBe(12);
  expect(c.col).toBe(5);
});

it("finds an absolute path", () => {
  const line = "open /Users/x/airlock/src/index.ts";
  const c = first(line);
  expect(c.path).toBe("/Users/x/airlock/src/index.ts");
  expect(span(line, c)).toBe("/Users/x/airlock/src/index.ts");
});

it("finds multiple candidates on one line", () => {
  const cs = findPathCandidates("a/b.ts and lib/c.tsx");
  expect(cs.map((c) => c.path)).toEqual(["a/b.ts", "lib/c.tsx"]);
});

it("strips a leading ./ from the matched path's range but keeps it resolvable", () => {
  const line = "edit ./pkg/x.ts";
  const c = first(line);
  expect(c.path).toBe("./pkg/x.ts");
  expect(span(line, c)).toBe("./pkg/x.ts");
});

it("trims surrounding punctuation (parens, quotes, trailing dot)", () => {
  expect(first("(src/a.ts)").path).toBe("src/a.ts");
  expect(first('"src/a.ts"').path).toBe("src/a.ts");
  expect(first("see foo.md.").path).toBe("foo.md");
});

it("rejects URLs", () => {
  expect(
    findPathCandidates("see https://github.com/o/r/blob/main/x.md please"),
  ).toEqual([]);
  expect(findPathCandidates("git://host/repo/file.ts")).toEqual([]);
});

it("rejects slash tokens whose final segment has no extension (and/or)", () => {
  expect(findPathCandidates("this and/or that")).toEqual([]);
});

it("requires a known extension for a bare (slash-less) filename", () => {
  expect(first("open config.ts now").path).toBe("config.ts");
  expect(findPathCandidates("version 1.2.3 shipped")).toEqual([]);
  expect(findPathCandidates("e.g. this")).toEqual([]);
});

it("linksForRows finds a path on a single row with a 1-based cell range", () => {
  const links = linksForRows(["edit src/a.ts ok"], 80, 4);
  expect(links).toHaveLength(1);
  const l = links[0];
  if (!l) throw new Error("no link");
  expect(l.path).toBe("src/a.ts");
  expect(l.text).toBe("src/a.ts");
  // "edit " = 5 chars -> 0-based start col 5 -> x=6; row 4 (0-based) -> y=5.
  expect([l.startX, l.startY]).toEqual([6, 5]);
  expect([l.endX, l.endY]).toEqual([13, 5]);
});

it("linksForRows reconstructs a path WRAPPED across two rows (multi-row range)", () => {
  // cols=10: "packages/x.ts" (13 chars) wraps as "packages/x" + ".ts".
  const links = linksForRows(["packages/x", ".ts"], 10, 7);
  expect(links).toHaveLength(1);
  const l = links[0];
  if (!l) throw new Error("no link");
  expect(l.path).toBe("packages/x.ts");
  expect([l.startX, l.startY]).toEqual([1, 8]); // row 7 -> y=8, col 0 -> x=1
  expect([l.endX, l.endY]).toEqual([3, 9]); // offset 12 -> row 7+1=8 -> y=9, col 2 -> x=3
});

it("resolveRel returns the relative path as-is, stripping a leading ./", () => {
  expect(resolveRel("/root", "docs/foo.md")).toBe("docs/foo.md");
  expect(resolveRel("/root", "./docs/foo.md")).toBe("docs/foo.md");
});

it("resolveRel makes an absolute path under root relative", () => {
  expect(resolveRel("/root", "/root/src/a.ts")).toBe("src/a.ts");
});

it("resolveRel returns null for an absolute path outside root, or the root itself", () => {
  expect(resolveRel("/root", "/other/x.ts")).toBeNull();
  expect(resolveRel("/root", "/root")).toBeNull();
});
