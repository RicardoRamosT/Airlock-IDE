import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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

  it("REFUSES a write whose baseline no longer matches the file on disk", async () => {
    // The silent work-loss case: you open a file, Claude (or git switch, or a
    // formatter) rewrites it on disk, you type one character, and 800ms later
    // the editor's autosave puts your stale buffer over the top of it. There
    // was no staleness check because FileContent carried no mtime at all.
    await writeFile(path.join(root, "a.ts"), "original", "utf8");
    const before = (await stat(path.join(root, "a.ts"))).mtimeMs;
    // Something else rewrites it.
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(path.join(root, "a.ts"), "claude rewrote this", "utf8");

    await expect(
      writeWorkspaceFile(root, "a.ts", "my stale buffer", {
        expectMtimeMs: before,
      }),
    ).rejects.toThrow(/changed on disk/i);
    // The other program's work survives.
    expect(await readFile(path.join(root, "a.ts"), "utf8")).toBe(
      "claude rewrote this",
    );
  });

  it("accepts a write whose baseline still matches, and returns the new mtime", async () => {
    await writeFile(path.join(root, "b.ts"), "v1", "utf8");
    const m = (await stat(path.join(root, "b.ts"))).mtimeMs;
    const res = await writeWorkspaceFile(root, "b.ts", "v2", {
      expectMtimeMs: m,
    });
    expect(await readFile(path.join(root, "b.ts"), "utf8")).toBe("v2");
    // The caller needs the NEW baseline, or its next save false-positives.
    expect(res.mtimeMs).toBe((await stat(path.join(root, "b.ts"))).mtimeMs);
  });

  it("still writes with no baseline given (an explicit overwrite)", async () => {
    await writeFile(path.join(root, "c.ts"), "v1", "utf8");
    await writeWorkspaceFile(root, "c.ts", "forced");
    expect(await readFile(path.join(root, "c.ts"), "utf8")).toBe("forced");
  });

  it("writes atomically and preserves the file mode", async () => {
    // A bare writeFile is O_TRUNC: a crash between truncate and write leaves
    // the user's source file empty. temp+rename means a reader sees either the
    // old bytes or the new ones, never nothing.
    const f = path.join(root, "exec.sh");
    await writeFile(f, "#!/bin/sh\ntrue\n", "utf8");
    await chmod(f, 0o755);
    await writeWorkspaceFile(root, "exec.sh", "#!/bin/sh\nfalse\n");
    expect(await readFile(f, "utf8")).toContain("false");
    expect((await stat(f)).mode & 0o777).toBe(0o755);
  });

  it("leaves no temp file behind", async () => {
    await writeWorkspaceFile(root, "d.txt", "x");
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(root)).filter((n) => n.includes(".tmp"))).toEqual([]);
  });
});
