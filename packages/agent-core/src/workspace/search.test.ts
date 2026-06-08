import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { searchProject } from "./search";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-search-"));
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "a.ts"), "const Hello = 1;\nconst x = 2;\n");
  await writeFile(path.join(root, "src", "b.ts"), "// hello world\n");
  await writeFile(path.join(root, "node_modules", "c.ts"), "hello skip\n");
  await writeFile(path.join(root, "blob.bin"), Buffer.from([0x68, 0x00, 0x69]));
});

describe("searchProject", () => {
  it("finds case-insensitive matches across files, with line/col/preview", async () => {
    const r = await searchProject(root, "hello");
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f]));
    expect(byPath["a.ts"]?.matches[0]).toEqual({
      line: 1,
      col: 6,
      preview: "const Hello = 1;",
    });
    expect(byPath["src/b.ts"]?.matches[0]?.line).toBe(1);
    // node_modules is pruned by listFilesRecursive's IGNORED set.
    expect(byPath["node_modules/c.ts"]).toBeUndefined();
    expect(r.truncated).toBe(false);
  });

  it("returns nothing for an empty query and skips binary files", async () => {
    expect(await searchProject(root, "  ")).toEqual({
      files: [],
      truncated: false,
    });
    const r = await searchProject(root, "hi");
    expect(r.files.some((f) => f.path === "blob.bin")).toBe(false);
  });

  it("flags truncation at maxResults", async () => {
    const r = await searchProject(root, "const", { maxResults: 1 });
    expect(r.truncated).toBe(true);
  });
});
