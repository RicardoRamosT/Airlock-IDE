import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readDocument } from "./document";

// The CONVERSION itself is mammoth's, and was verified against a real Word
// file (headings, bold runs and a table came back as <h1>/<strong>/<table>).
// What is tested here is the part this module owns: the guards it applies
// before handing a path to mammoth. The risky half of the feature -- turning
// that HTML into DOM without an injection surface -- is tested in the
// renderer's docxHtml.test.ts.
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
    // Under the cap the same file would reach mammoth and throw (it is not a
    // real zip), so a clean tooLarge proves the check ran FIRST.
    const d = await readDocument(dir, "big.docx", 1024);
    expect(d).toEqual({ html: "", tooLarge: true, notes: [] });
  });
});
