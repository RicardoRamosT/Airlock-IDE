import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isGitRepo, runGit } from "./run";

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-git-"));
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "test@airlock.local"]);
  await runGit(root, ["config", "user.name", "Airlock Test"]);
  return root;
}

describe("runGit", () => {
  it("runs git with argv arrays and returns stdout", async () => {
    const root = await makeRepo();
    const out = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
    expect(out.trim()).toBe("true");
  });

  it("throws with stderr content on failure", async () => {
    const root = await makeRepo();
    await expect(runGit(root, ["rev-parse", "not-a-ref"])).rejects.toThrow(
      /not-a-ref/,
    );
  });
});

describe("isGitRepo", () => {
  it("true inside a repo, false outside", async () => {
    const repo = await makeRepo();
    const plain = await mkdtemp(path.join(tmpdir(), "airlock-plain-"));
    await writeFile(path.join(plain, "x.txt"), "x");
    expect(await isGitRepo(repo)).toBe(true);
    expect(await isGitRepo(plain)).toBe(false);
  });
});
