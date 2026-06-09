import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES } from "../workspace/read";
import { runGit } from "./run";
import { gitFileVersions } from "./versions";

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-ver-"));
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "t@airlock.local"]);
  await runGit(root, ["config", "user.name", "T"]);
  await writeFile(path.join(root, "a.txt"), "committed\n");
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "init"]);
  return root;
}

describe("gitFileVersions", () => {
  it("unstaged: index vs worktree", async () => {
    const root = await makeRepo();
    await writeFile(path.join(root, "a.txt"), "worktree edit\n");
    const v = await gitFileVersions(root, "a.txt", "unstaged");
    expect(v.original).toBe("committed\n");
    expect(v.modified).toBe("worktree edit\n");
    expect(v.binary).toBe(false);
  });

  it("staged: HEAD vs index", async () => {
    const root = await makeRepo();
    await writeFile(path.join(root, "a.txt"), "staged edit\n");
    await runGit(root, ["add", "a.txt"]);
    await writeFile(path.join(root, "a.txt"), "worktree edit\n");
    const v = await gitFileVersions(root, "a.txt", "staged");
    expect(v.original).toBe("committed\n");
    expect(v.modified).toBe("staged edit\n");
  });

  // M2: a staged rename has no HEAD:<newPath>, so before the fix the original
  // showed as "" (the diff looked like a brand-new file). It must diff against
  // the renamed-FROM path's HEAD content.
  it("staged rename: original is the renamed-from HEAD content, not empty (M2)", async () => {
    const root = await makeRepo();
    await runGit(root, ["mv", "a.txt", "renamed.txt"]); // pure staged rename (R100)
    const v = await gitFileVersions(root, "renamed.txt", "staged");
    expect(v.original).toBe("committed\n");
    expect(v.modified).toBe("committed\n");
  });

  it("untracked file: empty original", async () => {
    const root = await makeRepo();
    await writeFile(path.join(root, "new.txt"), "brand new\n");
    const v = await gitFileVersions(root, "new.txt", "unstaged");
    expect(v.original).toBe("");
    expect(v.modified).toBe("brand new\n");
  });

  it("deleted-in-worktree file: empty modified", async () => {
    const root = await makeRepo();
    await rm(path.join(root, "a.txt"));
    const v = await gitFileVersions(root, "a.txt", "unstaged");
    expect(v.original).toBe("committed\n");
    expect(v.modified).toBe("");
  });

  it("flags binary content", async () => {
    const root = await makeRepo();
    await writeFile(path.join(root, "bin.dat"), Buffer.from([0, 1, 2, 255]));
    const v = await gitFileVersions(root, "bin.dat", "unstaged");
    expect(v.binary).toBe(true);
  });

  it("rejects paths escaping the workspace", async () => {
    const root = await makeRepo();
    await expect(
      gitFileVersions(root, "../outside.txt", "unstaged"),
    ).rejects.toThrow(/escapes workspace/);
  });

  it("flags worktree truncation on huge files", async () => {
    const root = await makeRepo();
    await writeFile(
      path.join(root, "big.txt"),
      Buffer.alloc(MAX_FILE_BYTES + 500_000, 0x61),
    );
    const v = await gitFileVersions(root, "big.txt", "unstaged");
    expect(v.truncated).toBe(true);
    expect(v.modified.length).toBe(MAX_FILE_BYTES);
  });
});
