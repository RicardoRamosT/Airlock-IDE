import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  commitStaged,
  createBranch,
  gitFetch,
  gitPull,
  gitPush,
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
    // L3: names git itself forbids -- leading dot, ".lock" suffix, trailing
    // dot/slash, "..", "//", and a "/." component.
    for (const bad of [
      ".hidden",
      "feature.lock",
      "trailing.",
      "trailing/",
      "a..b",
      "a//b",
      "foo/.bar",
    ]) {
      await expect(createBranch(root, bad)).rejects.toThrow(/branch name/i);
    }
    // a valid dotted/slashed name still works
    await createBranch(root, "feature/ok-1.2");
    expect(await listBranches(root)).toContain("feature/ok-1.2");
  });

  // L2: pushing in detached HEAD gave the raw "ref HEAD is not a symbolic ref"
  // fatal; it must be a clear, actionable message instead.
  it("gitPush gives a clear error in detached HEAD (L2)", async () => {
    const root = await makeRepo();
    const sha = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    await runGit(root, ["checkout", sha]); // detach HEAD
    await expect(gitPush(root)).rejects.toThrow(/detached/i);
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

async function makeRepoWithOrigin(): Promise<{ root: string; origin: string }> {
  const origin = await mkdtemp(path.join(tmpdir(), "airlock-origin-"));
  await runGit(origin, ["init", "--bare", "-b", "main"]);
  const root = await mkdtemp(path.join(tmpdir(), "airlock-clone-"));
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "t@airlock.local"]);
  await runGit(root, ["config", "user.name", "T"]);
  await runGit(root, ["remote", "add", "origin", origin]);
  await writeFile(path.join(root, "a.txt"), "one\n");
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "init"]);
  return { root, origin };
}

describe("git sync", () => {
  it("gitPush publishes (sets upstream) on first push", async () => {
    const { root } = await makeRepoWithOrigin();
    expect((await gitStatus(root)).branch.upstream).toBeNull();
    await gitPush(root);
    expect((await gitStatus(root)).branch.upstream).toBe("origin/main");
  });

  it("gitFetch then gitPull --ff-only fast-forwards a clone behind origin", async () => {
    const { root, origin } = await makeRepoWithOrigin();
    await gitPush(root); // publish main to origin
    // A second clone advances origin by one commit.
    const other = await mkdtemp(path.join(tmpdir(), "airlock-other-"));
    await runGit(other, ["clone", origin, "."]);
    await runGit(other, ["config", "user.email", "t2@airlock.local"]);
    await runGit(other, ["config", "user.name", "T2"]);
    await writeFile(path.join(other, "b.txt"), "two\n");
    await runGit(other, ["add", "."]);
    await runGit(other, ["commit", "-m", "second"]);
    await runGit(other, ["push"]);
    // Back in root: fetch makes it see it is behind, pull fast-forwards.
    await gitFetch(root);
    expect((await gitStatus(root)).branch.behind).toBe(1);
    await gitPull(root);
    expect((await gitStatus(root)).branch.behind).toBe(0);
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
