import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  commitStaged,
  createBranch,
  headSha,
  listBranches,
  originRemoteUrl,
  stageFiles,
  switchBranch,
  unstageFiles,
} from "./ops";
import { runGit } from "./run";
import { gitStatus } from "./status";

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-ops-"));
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "t@airlock.local"]);
  await runGit(root, ["config", "user.name", "T"]);
  await writeFile(path.join(root, "a.txt"), "one\n");
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "init"]);
  return root;
}

describe("git ops", () => {
  it("stages, unstages, and commits", async () => {
    const root = await makeRepo();
    await writeFile(path.join(root, "a.txt"), "changed\n");
    await stageFiles(root, ["a.txt"]);
    expect((await gitStatus(root)).staged.map((c) => c.path)).toEqual([
      "a.txt",
    ]);
    await unstageFiles(root, ["a.txt"]);
    expect((await gitStatus(root)).staged).toEqual([]);
    await stageFiles(root, ["a.txt"]);
    const sha = await commitStaged(root, "feat: change a");
    expect(sha).toMatch(/^[0-9a-f]{7,}$/);
    const s = await gitStatus(root);
    expect(s.staged).toEqual([]);
    expect(s.unstaged).toEqual([]);
  });

  it("rejects empty commit messages and empty path lists", async () => {
    const root = await makeRepo();
    await expect(commitStaged(root, "   ")).rejects.toThrow(/message/i);
    await expect(stageFiles(root, [])).rejects.toThrow(/paths/i);
  });

  it("lists, creates, and switches branches", async () => {
    const root = await makeRepo();
    expect(await listBranches(root)).toEqual(["main"]);
    await createBranch(root, "feature/x");
    expect((await gitStatus(root)).branch.head).toBe("feature/x");
    await switchBranch(root, "main");
    expect((await gitStatus(root)).branch.head).toBe("main");
    expect((await listBranches(root)).sort()).toEqual(["feature/x", "main"]);
  });

  it("rejects dangerous branch names", async () => {
    const root = await makeRepo();
    await expect(createBranch(root, "-d")).rejects.toThrow(/branch name/i);
    await expect(createBranch(root, "has space")).rejects.toThrow(
      /branch name/i,
    );
  });

  it("unstages on an unborn branch (no commits yet)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-unborn-"));
    await runGit(root, ["init", "-b", "main"]);
    await runGit(root, ["config", "user.email", "t@airlock.local"]);
    await runGit(root, ["config", "user.name", "T"]);
    await writeFile(path.join(root, "new.txt"), "x\n");
    await stageFiles(root, ["new.txt"]);
    expect((await gitStatus(root)).staged.map((c) => c.path)).toEqual([
      "new.txt",
    ]);
    await unstageFiles(root, ["new.txt"]);
    const s = await gitStatus(root);
    expect(s.staged).toEqual([]);
    expect(s.untracked).toEqual(["new.txt"]);
  });
});

describe("git origin and headSha", () => {
  it("returns the origin remote url, or null when none is set", async () => {
    const root = await makeRepo();
    expect(await originRemoteUrl(root)).toBeNull();
    await runGit(root, [
      "remote",
      "add",
      "origin",
      "https://github.com/o/r.git",
    ]);
    expect(await originRemoteUrl(root)).toBe("https://github.com/o/r.git");
  });

  it("resolves HEAD to a full 40-char sha", async () => {
    const root = await makeRepo();
    const sha = await headSha(root);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
