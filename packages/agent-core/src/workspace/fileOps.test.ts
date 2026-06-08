import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDir, createFile, duplicate, move } from "./fileOps";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "airlock-fileops-"));
});

describe("createFile", () => {
  it("creates an empty file", async () => {
    await createFile(root, "a.ts");
    expect(readFileSync(path.join(root, "a.ts"), "utf8")).toBe("");
  });
  it("rejects when the file already exists", async () => {
    writeFileSync(path.join(root, "a.ts"), "x");
    await expect(createFile(root, "a.ts")).rejects.toThrow(/exists/i);
  });
  it("rejects a path escaping the root", async () => {
    await expect(createFile(root, "../evil.ts")).rejects.toThrow(/escape/i);
  });
});

describe("createDir", () => {
  it("creates a directory", async () => {
    await createDir(root, "src");
    expect(existsSync(path.join(root, "src"))).toBe(true);
  });
  it("rejects when it already exists", async () => {
    mkdirSync(path.join(root, "src"));
    await expect(createDir(root, "src")).rejects.toThrow(/exists/i);
  });
});

describe("move", () => {
  it("renames a file", async () => {
    writeFileSync(path.join(root, "a.ts"), "x");
    await move(root, "a.ts", "b.ts");
    expect(existsSync(path.join(root, "a.ts"))).toBe(false);
    expect(readFileSync(path.join(root, "b.ts"), "utf8")).toBe("x");
  });
  it("moves a file into a subdir", async () => {
    writeFileSync(path.join(root, "a.ts"), "x");
    mkdirSync(path.join(root, "src"));
    await move(root, "a.ts", "src/a.ts");
    expect(readFileSync(path.join(root, "src/a.ts"), "utf8")).toBe("x");
  });
  it("rejects when the destination exists", async () => {
    writeFileSync(path.join(root, "a.ts"), "x");
    writeFileSync(path.join(root, "b.ts"), "y");
    await expect(move(root, "a.ts", "b.ts")).rejects.toThrow(/exists/i);
  });
});

describe("duplicate", () => {
  it("duplicates a file to 'name copy.ext' and returns the new relPath", async () => {
    writeFileSync(path.join(root, "report.ts"), "x");
    const out = await duplicate(root, "report.ts");
    expect(out).toBe("report copy.ts");
    expect(readFileSync(path.join(root, "report copy.ts"), "utf8")).toBe("x");
  });
  it("increments when a copy already exists", async () => {
    writeFileSync(path.join(root, "report.ts"), "x");
    writeFileSync(path.join(root, "report copy.ts"), "x");
    const out = await duplicate(root, "report.ts");
    expect(out).toBe("report copy 2.ts");
  });
  it("duplicates a directory recursively to 'name copy'", async () => {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/a.ts"), "x");
    const out = await duplicate(root, "src");
    expect(out).toBe("src copy");
    expect(readFileSync(path.join(root, "src copy/a.ts"), "utf8")).toBe("x");
  });
});
