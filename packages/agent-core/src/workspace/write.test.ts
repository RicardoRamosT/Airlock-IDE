import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { writeWorkspaceFile } from "./write";

describe("writeWorkspaceFile", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "airlock-write-"));
  });

  it("writes UTF-8 content to a file inside root, readable back", async () => {
    await writeWorkspaceFile(root, "note.txt", "hello\nworld");
    expect(await readFile(path.join(root, "note.txt"), "utf8")).toBe(
      "hello\nworld",
    );
  });

  it("overwrites existing content in place", async () => {
    await writeWorkspaceFile(root, "a.txt", "first");
    await writeWorkspaceFile(root, "a.txt", "second");
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("second");
  });

  it("rejects a path that escapes the root", async () => {
    await expect(
      writeWorkspaceFile(root, "../escape.txt", "x"),
    ).rejects.toBeDefined();
  });
});
