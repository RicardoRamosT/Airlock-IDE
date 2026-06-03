import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { listDirectory, resolveWithin } from "./tree";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-tree-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "index.ts"), "export {}");
  await writeFile(path.join(root, "readme.md"), "# hi");
  await mkdir(path.join(root, "node_modules"));
  await symlink("/etc", path.join(root, "sneaky"));
});

describe("resolveWithin", () => {
  it("resolves paths inside the root", async () => {
    const p = await resolveWithin(root, "src");
    expect(p.endsWith("/src")).toBe(true);
  });

  it("rejects .. traversal", async () => {
    await expect(resolveWithin(root, "../outside")).rejects.toThrow(
      /escapes workspace/,
    );
  });

  it("rejects symlinks that escape the root", async () => {
    await expect(resolveWithin(root, "sneaky")).rejects.toThrow(
      /escapes workspace/,
    );
  });
});

describe("listDirectory", () => {
  it("lists dirs first, then files, alphabetically, hiding ignored names", async () => {
    const entries = await listDirectory(root, ".");
    expect(entries).toEqual([
      { name: "src", type: "dir" },
      { name: "readme.md", type: "file" },
      { name: "sneaky", type: "file" },
    ]);
  });

  it("lists a subdirectory", async () => {
    const entries = await listDirectory(root, "src");
    expect(entries).toEqual([{ name: "index.ts", type: "file" }]);
  });
});
