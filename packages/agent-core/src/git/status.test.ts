import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGit } from "./run";
import { gitStatus, parsePorcelainV2 } from "./status";

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-st-"));
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "t@airlock.local"]);
  await runGit(root, ["config", "user.name", "T"]);
  await writeFile(path.join(root, "a.txt"), "one\n");
  await writeFile(path.join(root, "b.txt"), "two\n");
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "init"]);
  return root;
}

describe("parsePorcelainV2 (pure)", () => {
  it("parses branch header, changes, renames, and untracked from -z output", () => {
    const raw = [
      "# branch.oid abc123",
      "# branch.head main",
      "1 .M N... 100644 100644 100644 h1 h2 a.txt",
      "1 A. N... 000000 100644 100644 h3 h4 new with space.txt",
      "2 R. N... 100644 100644 100644 h5 h6 R100 renamed.txt",
      "old.txt",
      "? untracked.txt",
    ].join("\0");
    const s = parsePorcelainV2(raw);
    expect(s.branch.head).toBe("main");
    expect(s.unstaged).toEqual([
      { path: "a.txt", index: ".", worktree: "M", origPath: null },
    ]);
    expect(s.staged).toEqual([
      { path: "new with space.txt", index: "A", worktree: ".", origPath: null },
      { path: "renamed.txt", index: "R", worktree: ".", origPath: "old.txt" },
    ]);
    expect(s.untracked).toEqual(["untracked.txt"]);
  });

  it("parses ahead/behind when upstream exists", () => {
    const raw = [
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
    ].join("\0");
    const s = parsePorcelainV2(raw);
    expect(s.branch.upstream).toBe("origin/main");
    expect(s.branch.ahead).toBe(2);
    expect(s.branch.behind).toBe(1);
  });
});

describe("gitStatus (integration)", () => {
  it("reports staged, unstaged, and untracked against a real repo", async () => {
    const root = await makeRepo();
    await writeFile(path.join(root, "a.txt"), "one\nmodified\n");
    await runGit(root, ["add", "a.txt"]);
    await writeFile(path.join(root, "b.txt"), "two\nplus\n");
    await mkdir(path.join(root, "dir"));
    await writeFile(path.join(root, "dir", "new file.txt"), "x\n");
    const s = await gitStatus(root);
    expect(s.branch.head).toBe("main");
    expect(s.staged.map((c) => c.path)).toEqual(["a.txt"]);
    expect(s.unstaged.map((c) => c.path)).toEqual(["b.txt"]);
    expect(s.untracked).toEqual(["dir/new file.txt"]);
  });

  it("reports a rename as staged with origPath", async () => {
    const root = await makeRepo();
    await rename(path.join(root, "a.txt"), path.join(root, "c.txt"));
    await runGit(root, ["add", "-A"]);
    const s = await gitStatus(root);
    expect(s.staged).toHaveLength(1);
    expect(s.staged[0]?.index).toBe("R");
    expect(s.staged[0]?.path).toBe("c.txt");
    expect(s.staged[0]?.origPath).toBe("a.txt");
  });
});
