import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeProjectsDirName, hasResumableClaudeSession } from "./session";

describe("claudeProjectsDirName", () => {
  it("replaces every non-alphanumeric char with a dash", () => {
    expect(claudeProjectsDirName("/Users/ricardoramos/Projects/airlock")).toBe(
      "-Users-ricardoramos-Projects-airlock",
    );
  });

  it("replaces dots and other punctuation", () => {
    expect(
      claudeProjectsDirName("/Users/ricardoramos/Projects/LendLogic.LOS"),
    ).toBe("-Users-ricardoramos-Projects-LendLogic-LOS");
  });

  it("handles a bare alphanumeric name without replacement", () => {
    expect(claudeProjectsDirName("myproject")).toBe("myproject");
  });
});

describe("hasResumableClaudeSession", () => {
  it("returns true when the project dir has at least one .jsonl file", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "airlock-session-test-"));
    const root = await mkdtemp(path.join(os.tmpdir(), "airlock-root-"));
    const dirName = claudeProjectsDirName(root);
    const projectDir = path.join(home, ".claude", "projects", dirName);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "x.jsonl"), "{}");

    expect(await hasResumableClaudeSession(root, home)).toBe(true);
  });

  it("returns false when the project dir is empty (no .jsonl files)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "airlock-session-test-"));
    const root = await mkdtemp(path.join(os.tmpdir(), "airlock-root-"));
    const dirName = claudeProjectsDirName(root);
    const projectDir = path.join(home, ".claude", "projects", dirName);
    await mkdir(projectDir, { recursive: true });

    expect(await hasResumableClaudeSession(root, home)).toBe(false);
  });

  it("returns false when the project dir does not exist", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "airlock-session-test-"));
    const root = await mkdtemp(path.join(os.tmpdir(), "airlock-root-"));

    expect(await hasResumableClaudeSession(root, home)).toBe(false);
  });

  it("returns false when the project dir has only non-jsonl files", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "airlock-session-test-"));
    const root = await mkdtemp(path.join(os.tmpdir(), "airlock-root-"));
    const dirName = claudeProjectsDirName(root);
    const projectDir = path.join(home, ".claude", "projects", dirName);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "notes.txt"), "hello");
    await writeFile(path.join(projectDir, "config.json"), "{}");

    expect(await hasResumableClaudeSession(root, home)).toBe(false);
  });
});
