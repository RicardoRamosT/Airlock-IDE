import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readDocument } from "./document";

// The OOXML interpretation lives in docxModel.ts and is unit tested there
// against real Word markup. What is tested here is the part this module owns:
// the guards it applies before opening the file at all.
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "doc-"));
  writeFileSync(join(dir, "big.docx"), Buffer.alloc(2048));
});

describe("readDocument", () => {
  it("refuses a path inside the vault before reading anything", async () => {
    await expect(readDocument(dir, ".airlock/secrets.docx")).rejects.toThrow(
      /\.airlock/,
    );
  });

  it("reports tooLarge instead of parsing an oversized document", async () => {
    // Under the cap the same file would reach the zip reader and throw (it is
    // not a real zip), so a clean tooLarge proves the check ran FIRST.
    const d = await readDocument(dir, "big.docx", 1024);
    expect(d.tooLarge).toBe(true);
    expect(d.doc.blocks).toEqual([]);
  });
});
