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

  // C7: a write into .airlock could forge or destroy the tamper-evident audit
  // chain + the vault metadata. writeWorkspaceFile must reject it (the
  // fs:writeFile handler does too); this self-guard covers every caller, and
  // path-normalized bypasses must be caught.
  it("rejects a write into the .airlock vault", async () => {
    await expect(
      writeWorkspaceFile(root, ".airlock/secrets.json", "[]"),
    ).rejects.toThrow(/\.airlock/);
    await expect(
      writeWorkspaceFile(root, "sub/../.airlock/audit/log.jsonl", "x"),
    ).rejects.toThrow(/\.airlock/);
  });
});
