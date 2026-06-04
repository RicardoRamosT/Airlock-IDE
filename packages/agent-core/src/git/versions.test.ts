import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
});
