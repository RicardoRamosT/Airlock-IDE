import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDir,
  createFile,
  duplicate,
  importExternal,
  move,
  uniqueName,
} from "./fileOps";

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
    // M9: the destination is NOT clobbered and the source survives the rejection
    expect(readFileSync(path.join(root, "b.ts"), "utf8")).toBe("y");
    expect(readFileSync(path.join(root, "a.ts"), "utf8")).toBe("x");
  });
  // M9: a directory move takes the link->EISDIR/EPERM fallback to rename.
  it("moves a directory", async () => {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/a.ts"), "x");
    await move(root, "src", "lib");
    expect(existsSync(path.join(root, "src"))).toBe(false);
    expect(readFileSync(path.join(root, "lib/a.ts"), "utf8")).toBe("x");
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

describe("uniqueName", () => {
  it("returns the desired name when it is free", () => {
    expect(uniqueName("report.pdf", new Set())).toBe("report.pdf");
  });
  it("appends ' 2', ' 3' before the extension on clashes", () => {
    expect(uniqueName("report.pdf", new Set(["report.pdf"]))).toBe(
      "report 2.pdf",
    );
    expect(
      uniqueName("report.pdf", new Set(["report.pdf", "report 2.pdf"])),
    ).toBe("report 3.pdf");
  });
  it("handles no-extension names and folders", () => {
    expect(uniqueName("src", new Set(["src"]))).toBe("src 2");
  });
  it("treats a dotfile as having no extension", () => {
    expect(uniqueName(".env", new Set([".env"]))).toBe(".env 2");
  });
});

describe("importExternal", () => {
  it("copies external files into destRel and reports them", async () => {
    const ext = await mkdtemp(path.join(tmpdir(), "airlock-ext-"));
    await writeFile(path.join(ext, "a.txt"), "AAA");
    await mkdir(path.join(root, "sub"));
    const r = await importExternal(root, "sub", [path.join(ext, "a.txt")]);
    expect(r.imported).toEqual(["a.txt"]);
    expect(r.failed).toEqual([]);
    expect(await readFile(path.join(root, "sub", "a.txt"), "utf8")).toBe("AAA");
  });

  it("copies a folder recursively", async () => {
    const ext = await mkdtemp(path.join(tmpdir(), "airlock-ext-"));
    await mkdir(path.join(ext, "dir"));
    await writeFile(path.join(ext, "dir", "n.txt"), "N");
    const r = await importExternal(root, ".", [path.join(ext, "dir")]);
    expect(r.imported).toEqual(["dir"]);
    expect(await readFile(path.join(root, "dir", "n.txt"), "utf8")).toBe("N");
  });

  it("auto-renames on conflict, keeping the existing file intact", async () => {
    const ext = await mkdtemp(path.join(tmpdir(), "airlock-ext-"));
    await writeFile(path.join(root, "a.txt"), "ORIGINAL");
    await writeFile(path.join(ext, "a.txt"), "NEW");
    const r = await importExternal(root, ".", [path.join(ext, "a.txt")]);
    expect(r.imported).toEqual(["a 2.txt"]);
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("ORIGINAL");
    expect(await readFile(path.join(root, "a 2.txt"), "utf8")).toBe("NEW");
  });

  it("gives two same-named sources in one call distinct names", async () => {
    const e1 = await mkdtemp(path.join(tmpdir(), "airlock-ext-"));
    const e2 = await mkdtemp(path.join(tmpdir(), "airlock-ext-"));
    await writeFile(path.join(e1, "x.txt"), "1");
    await writeFile(path.join(e2, "x.txt"), "2");
    const r = await importExternal(root, ".", [
      path.join(e1, "x.txt"),
      path.join(e2, "x.txt"),
    ]);
    expect(r.imported).toEqual(["x.txt", "x 2.txt"]);
  });

  it("records a failed source and still imports the rest", async () => {
    const ext = await mkdtemp(path.join(tmpdir(), "airlock-ext-"));
    await writeFile(path.join(ext, "ok.txt"), "OK");
    const r = await importExternal(root, ".", [
      path.join(ext, "missing.txt"),
      path.join(ext, "ok.txt"),
    ]);
    expect(r.imported).toEqual(["ok.txt"]);
    expect(r.failed.map((f) => f.name)).toEqual(["missing.txt"]);
    expect(await stat(path.join(root, "ok.txt"))).toBeDefined();
  });
});
