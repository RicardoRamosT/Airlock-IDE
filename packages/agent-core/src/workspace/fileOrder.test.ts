import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readOrder, writeFolderOrder } from "./fileOrder";
import { ORDER_FILE } from "./tree";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "airlock-order-"));
});

describe("readOrder", () => {
  it("returns an empty map when the file is absent", async () => {
    expect(await readOrder(root)).toEqual({});
  });
  it("returns an empty map on malformed JSON", async () => {
    writeFileSync(path.join(root, ORDER_FILE), "{not json");
    expect(await readOrder(root)).toEqual({});
  });
  it("returns an empty map on an unrecognized version", async () => {
    writeFileSync(
      path.join(root, ORDER_FILE),
      JSON.stringify({ version: 999, order: { ".": ["a"] } }),
    );
    expect(await readOrder(root)).toEqual({});
  });
  it("drops malformed entries (non-array / non-string names)", async () => {
    writeFileSync(
      path.join(root, ORDER_FILE),
      JSON.stringify({ version: 1, order: { ".": ["a"], bad: 5, mix: [1] } }),
    );
    expect(await readOrder(root)).toEqual({ ".": ["a"] });
  });
});

describe("writeFolderOrder", () => {
  it("round-trips a folder's order and writes to the project root", async () => {
    await writeFolderOrder(root, "src", ["b.ts", "a.ts"]);
    expect(await readOrder(root)).toEqual({ src: ["b.ts", "a.ts"] });
    expect(readFileSync(path.join(root, ORDER_FILE), "utf8")).toContain("b.ts");
  });
  it("merges folders across writes", async () => {
    await writeFolderOrder(root, ".", ["x"]);
    await writeFolderOrder(root, "src", ["y"]);
    expect(await readOrder(root)).toEqual({ ".": ["x"], src: ["y"] });
  });
  it("an empty names array clears that folder's key", async () => {
    await writeFolderOrder(root, "src", ["a"]);
    await writeFolderOrder(root, "src", []);
    expect(await readOrder(root)).toEqual({});
  });
});
