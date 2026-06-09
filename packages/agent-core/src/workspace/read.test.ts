import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, readImageDataUrl, readWorkspaceFile } from "./read";

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

  // H7: the .airlock vault holds the secret-NAME inventory + the audit log;
  // readWorkspaceFile must refuse it (the fs:readFile handler does too), whether
  // or not the path exists, including path-normalized bypasses.
  it("rejects reading inside the .airlock vault", async () => {
    await expect(
      readWorkspaceFile(root, ".airlock/secrets.json"),
    ).rejects.toThrow(/\.airlock/);
    await expect(
      readWorkspaceFile(root, "./.airlock/audit/log.jsonl"),
    ).rejects.toThrow(/\.airlock/);
  });

  it("rejects traversal outside the workspace", async () => {
    await expect(readWorkspaceFile(root, "../../etc/hosts")).rejects.toThrow(
      /escapes workspace/,
    );
  });

  it("flags small text as non-binary with its size", async () => {
    const f = await readWorkspaceFile(root, "small.txt");
    expect(f.binary).toBe(false);
    expect(f.size).toBe(13); // "hello airlock"
  });

  it("treats a file containing a NUL byte as binary (empty content)", async () => {
    await writeFile(
      path.join(root, "blob.bin"),
      Buffer.from([0x50, 0x00, 0x4e]),
    );
    const f = await readWorkspaceFile(root, "blob.bin");
    expect(f.binary).toBe(true);
    expect(f.content).toBe("");
  });
});

describe("readImageDataUrl", () => {
  it("readImageDataUrl returns a data URL for a png", async () => {
    await writeFile(
      path.join(root, "x.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    const r = await readImageDataUrl(root, "x.png");
    expect(r.tooLarge).toBe(false);
    expect(r.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("readImageDataUrl flags an over-cap file as tooLarge", async () => {
    await writeFile(path.join(root, "huge.png"), Buffer.alloc(100));
    const r = await readImageDataUrl(root, "huge.png", 50);
    expect(r.tooLarge).toBe(true);
    expect(r.dataUrl).toBe("");
  });
});
