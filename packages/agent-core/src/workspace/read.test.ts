import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, readWorkspaceFile } from "./read";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-read-"));
  await writeFile(path.join(root, "small.txt"), "hello airlock");
  await writeFile(
    path.join(root, "big.txt"),
    Buffer.alloc(MAX_FILE_BYTES + 500_000, 0x61),
  );
});

describe("readWorkspaceFile", () => {
  it("reads a small file fully", async () => {
    const f = await readWorkspaceFile(root, "small.txt");
    expect(f.content).toBe("hello airlock");
    expect(f.truncated).toBe(false);
  });

  it("caps huge files and flags truncation", async () => {
    const f = await readWorkspaceFile(root, "big.txt");
    // ASCII fixture: 1 byte == 1 char, so length happens to equal MAX_FILE_BYTES
    expect(f.content.length).toBe(MAX_FILE_BYTES);
    expect(f.truncated).toBe(true);
  });

  it("rejects traversal outside the workspace", async () => {
    await expect(readWorkspaceFile(root, "../../etc/hosts")).rejects.toThrow(
      /escapes workspace/,
    );
  });
});
