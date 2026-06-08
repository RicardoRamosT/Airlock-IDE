import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { listDirectory, resolveWithin, targetsVault } from "./tree";

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

  it("rejects nonexistent path through a symlinked ancestor dir", async () => {
    // root/sneaky is a symlink to /etc in the fixture
    await expect(resolveWithin(root, "sneaky/newfile")).rejects.toThrow(
      /escapes workspace/,
    );
  });

  it("allows nonexistent nested paths under real directories", async () => {
    const p = await resolveWithin(root, "newdir/sub/file.txt");
    expect(p.endsWith("/newdir/sub/file.txt")).toBe(true);
  });

  it("rejects absolute paths outside the workspace", async () => {
    await expect(resolveWithin(root, "/etc/passwd")).rejects.toThrow(
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

  it("hides .airlock-order.json from listings", async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), "airlock-tree-order-"));
    writeFileSync(path.join(root2, ".airlock-order.json"), "{}");
    writeFileSync(path.join(root2, "a.ts"), "");
    const names = (await listDirectory(root2, ".")).map((e) => e.name);
    expect(names).toEqual(["a.ts"]);
  });
});

describe("targetsVault", () => {
  it("flags the .airlock dir and anything inside it", () => {
    expect(targetsVault(".airlock")).toBe(true);
    expect(targetsVault(".airlock/secrets.json")).toBe(true);
  });
  it("flags bypass attempts that resolve into .airlock", () => {
    expect(targetsVault("./.airlock/secrets.json")).toBe(true);
    expect(targetsVault("sub/../.airlock/secrets.json")).toBe(true);
    expect(targetsVault("a/.airlock/b")).toBe(true); // nested at any depth
  });
  it("allows normal paths, incl. names that merely contain '.airlock'", () => {
    expect(targetsVault("src/index.ts")).toBe(false);
    expect(targetsVault("normal/file.airlock.ts")).toBe(false);
    expect(targetsVault(".airlockish/x")).toBe(false);
  });
});
