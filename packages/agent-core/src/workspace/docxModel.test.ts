import { describe, expect, it } from "vitest";
import { type DocxParagraph, type DocxTable, parseDocx } from "./docxModel";

const wrap = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<w:document
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>${inner}</w:body></w:document>`;

const paras = (xml: string): DocxParagraph[] =>
  parseDocx({ documentXml: wrap(xml) }).blocks.filter(
    (b): b is DocxParagraph => b.kind === "p",
  );

// The exact shape of the real document this was built against: direct run
// formatting, no named styles. Mammoth dropped every one of these properties,
// which is why the viewer showed left-aligned black text.
const TITLE = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr>
  <w:rFonts w:ascii="Arial"/><w:b/><w:i w:val="0"/>
  <w:color w:val="1C5CAB"/><w:sz w:val="36"/>
</w:rPr><w:t>Estructuración de la información</w:t></w:r></w:p>`;

describe("run formatting", () => {
  it("keeps colour, size, weight and font from direct formatting", () => {
    const [p] = paras(TITLE);
    expect(p?.align).toBe("center");
    expect(p?.runs[0]).toMatchObject({
      kind: "text",
      text: "Estructuración de la información",
      color: "#1c5cab",
      size: 18, // w:sz is HALF-points
      bold: true,
      font: "Arial",
    });
  });

  it('reads w:val="0" as OFF, not as present-so-true', () => {
    const [p] = paras(TITLE);
    expect((p?.runs[0] as { italic?: boolean }).italic).toBeUndefined();
  });

  it("drops a colour that is not a plain hex triplet", () => {
    // The model is applied as an inline style, so anything that is not exactly
    // six hex digits must not reach the renderer.
    const bad = paras(
      `<w:p><w:r><w:rPr><w:color w:val="red;background:url(x)"/></w:rPr><w:t>x</w:t></w:r></w:p>`,
    );
    expect((bad[0]?.runs[0] as { color?: string }).color).toBeUndefined();
    // "auto" means "let the reader decide" -- not a colour.
    const auto = paras(
      `<w:p><w:r><w:rPr><w:color w:val="auto"/></w:rPr><w:t>x</w:t></w:r></w:p>`,
    );
    expect((auto[0]?.runs[0] as { color?: string }).color).toBeUndefined();
  });

  it("clamps an absurd font size instead of trusting it", () => {
    const [p] = paras(
      `<w:p><w:r><w:rPr><w:sz w:val="999999"/></w:rPr><w:t>x</w:t></w:r></w:p>`,
    );
    expect((p?.runs[0] as { size?: number }).size).toBeLessThanOrEqual(200);
  });

  it("keeps a run's text even with no properties at all", () => {
    const [p] = paras(`<w:p><w:r><w:t>plain</w:t></w:r></w:p>`);
    expect(p?.runs[0]).toMatchObject({ kind: "text", text: "plain" });
  });

  it("preserves significant whitespace", () => {
    const [p] = paras(
      `<w:p><w:r><w:t xml:space="preserve">Alumno: </w:t></w:r><w:r><w:t>Ricardo</w:t></w:r></w:p>`,
    );
    expect(p?.runs.map((r) => (r as { text: string }).text).join("")).toBe(
      "Alumno: Ricardo",
    );
  });
});

describe("paragraph properties", () => {
  it("maps every alignment Word emits", () => {
    for (const [val, want] of [
      ["center", "center"],
      ["right", "right"],
      ["both", "justify"],
      ["left", "left"],
    ]) {
      const [p] = paras(
        `<w:p><w:pPr><w:jc w:val="${val}"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`,
      );
      expect(p?.align).toBe(want);
    }
  });

  it("turns a bottom border into a rule (the line under the title block)", () => {
    const [p] = paras(
      `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="1C5CAB"/></w:pBdr></w:pPr></w:p>`,
    );
    expect(p?.rule).toBe(true);
  });

  it("reads a heading level from the paragraph style", () => {
    const [p] = paras(
      `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>1. Intro</w:t></w:r></w:p>`,
    );
    expect(p?.heading).toBe(2);
  });

  it("converts twip spacing and indent to points", () => {
    const [p] = paras(
      `<w:p><w:pPr><w:spacing w:before="280" w:after="60"/><w:ind w:left="720"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`,
    );
    expect(p?.spaceBefore).toBeCloseTo(14); // 280 twips = 14pt
    expect(p?.spaceAfter).toBeCloseTo(3);
    expect(p?.indent).toBeCloseTo(36); // 720 twips = 36pt = half an inch
  });

  it("marks a bulleted list item", () => {
    const [p] = paras(
      `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>item</w:t></w:r></w:p>`,
    );
    expect(p?.list).toMatchObject({ kind: "bullet" });
  });
});

describe("tables and images", () => {
  it("reads rows, cells and cell shading", () => {
    const doc = parseDocx({
      documentXml: wrap(
        `<w:tbl><w:tr><w:tc>
           <w:tcPr><w:shd w:fill="D9E2F3"/></w:tcPr>
           <w:p><w:r><w:t>Fecha</w:t></w:r></w:p>
         </w:tc><w:tc><w:p><w:r><w:t>17.20</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      ),
    });
    const t = doc.blocks[0] as DocxTable;
    expect(t.kind).toBe("table");
    expect(t.rows[0]?.cells).toHaveLength(2);
    expect(t.rows[0]?.cells[0]?.shade).toBe("#d9e2f3");
    expect(
      (t.rows[0]?.cells[0]?.blocks[0] as DocxParagraph).runs[0],
    ).toMatchObject({ text: "Fecha" });
  });

  it("does NOT hoist a table's paragraphs to the top level", () => {
    // getElementsByTagName would return them at any depth; the body walk has to
    // take direct children only, or every cell's text is duplicated as prose.
    const doc = parseDocx({
      documentXml: wrap(
        `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>in-cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      ),
    });
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]?.kind).toBe("table");
  });

  it("resolves an embedded image through the relationship id", () => {
    const [p] = parseDocx({
      documentXml: wrap(
        `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="2743200" cy="1828800"/>
           <a:graphic><a:graphicData><pic:pic
             xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
             <pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill>
           </pic:pic></a:graphicData></a:graphic>
         </wp:inline></w:drawing></w:r></w:p>`,
      ),
      images: { rId7: "data:image/png;base64,AAAA" },
    }).blocks as DocxParagraph[];
    expect(p?.runs[0]).toMatchObject({
      kind: "image",
      src: "data:image/png;base64,AAAA",
      width: 216, // 2743200 EMU = 3in = 216pt (914400 EMU/in, 72pt/in)
    });
  });

  it("drops an image whose relationship is unknown", () => {
    const [p] = parseDocx({
      documentXml: wrap(
        `<w:p><w:r><w:drawing><a:blip r:embed="rIdMissing"/></w:drawing></w:r></w:p>`,
      ),
    }).blocks as DocxParagraph[];
    expect(p?.runs).toHaveLength(0);
  });
});

describe("page setup", () => {
  it("reads the page size and margins so the paper matches Word", () => {
    const doc = parseDocx({
      documentXml: wrap(
        `<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>
         <w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>`,
      ),
    });
    expect(doc.page.width).toBeCloseTo(612); // 12240 twips = 8.5in = 612pt
    expect(doc.page.margin.left).toBeCloseTo(70.85);
  });

  it("falls back to Letter when the section is missing", () => {
    const doc = parseDocx({ documentXml: wrap("<w:p/>") });
    expect(doc.page.width).toBeCloseTo(612);
    expect(doc.page.margin.left).toBeGreaterThan(0);
  });
});

describe("robustness", () => {
  it("returns an empty document rather than throwing on junk", () => {
    expect(parseDocx({ documentXml: "not xml at all" }).blocks).toEqual([]);
    expect(parseDocx({ documentXml: "" }).blocks).toEqual([]);
  });
});
