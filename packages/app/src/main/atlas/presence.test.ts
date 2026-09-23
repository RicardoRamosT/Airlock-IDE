import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { presenceForError, probeRoot, probeRoots } from "./presence";

it("says PRESENT for a directory that is there", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "presence-"));
  expect(await probeRoot(dir)).toBe("present");
  rmSync(dir, { recursive: true, force: true });
});

it("says GONE for a path that does not exist", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "presence-"));
  rmSync(dir, { recursive: true, force: true });
  expect(await probeRoot(dir)).toBe("gone");
});

it("says GONE when a parent component is a FILE, not a directory", async () => {
  // ENOTDIR. The path as written cannot exist, which is the same answer as
  // ENOENT -- unlike a permission or I/O failure, nothing is being hidden.
  const dir = mkdtempSync(path.join(tmpdir(), "presence-"));
  const file = path.join(dir, "notadir");
  writeFileSync(file, "x");
  expect(await probeRoot(path.join(file, "project"))).toBe("gone");
  rmSync(dir, { recursive: true, force: true });
});

it("says UNKNOWN for a real permission failure, not GONE", async () => {
  // THE case the old bare `catch` collapsed, driven for real: the project is
  // right there, but its parent denies traversal -- which is what macOS TCC
  // does to ~/Documents and to removable volumes until you grant access.
  // Flagging this "missing" would drop a live project from the debrief, the
  // spine and the local-app monitor without a word.
  const dir = mkdtempSync(path.join(tmpdir(), "presence-"));
  const project = path.join(dir, "project");
  mkdirSync(project);
  chmodSync(dir, 0o000);
  try {
    expect(await probeRoot(project)).toBe("unknown");
  } finally {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

it("classifies every other errno as UNKNOWN, and only absence as GONE", () => {
  expect(presenceForError("ENOENT")).toBe("gone");
  expect(presenceForError("ENOTDIR")).toBe("gone");
  for (const code of ["EACCES", "EPERM", "EIO", "ELOOP", "EHOSTDOWN"])
    expect(presenceForError(code), code).toBe("unknown");
  // No code at all is still not evidence of absence.
  expect(presenceForError(undefined)).toBe("unknown");
});

it("probes many roots and answers for each", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "presence-"));
  const got = await probeRoots([dir, path.join(dir, "nope")]);
  expect(got.get(dir)).toBe("present");
  expect(got.get(path.join(dir, "nope"))).toBe("gone");
  rmSync(dir, { recursive: true, force: true });
});
