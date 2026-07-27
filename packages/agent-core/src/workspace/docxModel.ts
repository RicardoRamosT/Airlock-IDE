// packages/agent-core/src/workspace/docxModel.ts
// Read the presentation of a .docx -- colour, alignment, size, borders,
// tables -- into a STRUCTURED model.
//
// Why not mammoth (which this replaced): mammoth converts SEMANTIC styles only.
// It maps "Heading 1" to <h1> and deliberately discards direct formatting, so a
// document that centres a blue 18pt title with <w:jc>/<w:color>/<w:sz> rather
// than a named style came out as <p><strong>text</strong></p> -- no colour, no
// centring, no sizes, and no warning that anything had been dropped. That is
// most real-world Word documents.
//
// The output is DATA, never markup. The old pipeline shipped an HTML string the
// renderer had to re-parse and sanitise; here every value is validated at the
// boundary below (colours must be a hex triplet, sizes are clamped, image
// sources must already be data: URIs), so the renderer can apply them as inline
// styles without a sanitiser standing between them. Anything unparseable
// degrades to an empty document rather than throwing.
// ASCII-only file.
import { DOMParser } from "@xmldom/xmldom";

export type DocxAlign = "left" | "center" | "right" | "justify";

export interface DocxTextRun {
  kind: "text";
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string; // "#rrggbb", lower case
  highlight?: string; // "#rrggbb"
  size?: number; // POINTS (w:sz is half-points)
  font?: string;
  vertAlign?: "super" | "sub";
}

export interface DocxImageRun {
  kind: "image";
  src: string; // a data: URI, vetted by the caller that built it
  width?: number; // points
  height?: number; // points
  alt?: string;
}

export type DocxInline = DocxTextRun | DocxImageRun;

export interface DocxParagraph {
  kind: "p";
  runs: DocxInline[];
  align?: DocxAlign;
  heading?: number; // 1..6, from the paragraph style
  list?: { kind: "bullet" | "number"; level: number };
  indent?: number; // points
  spaceBefore?: number; // points
  spaceAfter?: number; // points
  rule?: boolean; // bottom border -> a horizontal rule
}

export interface DocxCell {
  blocks: DocxBlock[];
  shade?: string; // "#rrggbb"
  width?: number; // points
  colSpan?: number;
}
export interface DocxRow {
  cells: DocxCell[];
  header?: boolean;
}
export interface DocxTable {
  kind: "table";
  rows: DocxRow[];
}

export type DocxBlock = DocxParagraph | DocxTable;

export interface DocxPage {
  width: number; // points
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface DocxDoc {
  blocks: DocxBlock[];
  page: DocxPage;
}

export interface DocxSource {
  documentXml: string;
  stylesXml?: string;
  numberingXml?: string;
  // relationship id -> data: URI. The I/O layer reads the zip parts and vets
  // the URIs; this module only wires them to the runs that reference them.
  images?: Record<string, string>;
}

// US Letter, 1 inch margins -- what Word uses when a document omits its section.
const LETTER: DocxPage = {
  width: 612,
  margin: { top: 72, right: 72, bottom: 72, left: 72 },
};

// --- unit conversions ------------------------------------------------------
// Word measures in twips (1/20 pt) for layout, half-points for font size, and
// EMU (1/914400 in) for drawings. Everything below is POINTS, so the renderer
// can emit `pt` and land on the same geometry Word shows.
const twipToPt = (v: number) => v / 20;
const emuToPt = (v: number) => (v / 914400) * 72;

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// A length that is about to become CSS. Non-finite or wild values are dropped
// rather than clamped-and-used, so a corrupt document cannot push content off
// the page.
function len(v: number | undefined, max: number): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  if (v <= 0) return undefined;
  return Math.min(v, max);
}

// A Word colour is six hex digits. "auto" means "reader decides", which is not
// a colour. Everything else -- including anything that could carry CSS syntax
// -- is rejected outright.
const HEX6 = /^[0-9a-f]{6}$/i;
function color(v: string | null): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (!HEX6.test(s)) return undefined;
  return `#${s.toLowerCase()}`;
}

// Font family names reach CSS, so keep them to characters that cannot break out
// of the quoted family they are rendered in.
const FONT_OK = /^[A-Za-z0-9 ,.\-_]{1,64}$/;
function fontName(v: string | null): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  return FONT_OK.test(s) ? s : undefined;
}

// --- tiny DOM helpers ------------------------------------------------------
// Deliberately NOT getElementsByTagName: that searches all descendants, so a
// table's paragraphs would also be collected as top-level prose (every cell's
// text duplicated above the table).
type El = Element;
function childElements(el: El): El[] {
  const out: El[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) out.push(n as unknown as El);
  }
  return out;
}
function kids(el: El | undefined, name: string): El[] {
  return el ? childElements(el).filter((c) => c.nodeName === name) : [];
}
function kid(el: El | undefined, name: string): El | undefined {
  return kids(el, name)[0];
}
// A descendant lookup for the places where depth genuinely varies (a drawing's
// blip sits several DrawingML levels down and the intermediate elements differ
// between inline and anchored images).
function firstDeep(el: El, name: string): El | undefined {
  const list = el.getElementsByTagName(name);
  return (list.item(0) as unknown as El) ?? undefined;
}
function attr(el: El | undefined, name: string): string | null {
  return el ? el.getAttribute(name) : null;
}

// Word's on/off attributes: the element being PRESENT means on, unless it
// carries w:val="0"/"false". `<w:i w:val="0"/>` inside a bold run is common --
// reading presence alone would italicise half the document.
function onOff(el: El | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = el.getAttribute("w:val");
  if (v === null) return true;
  return v !== "0" && v !== "false" && v !== "off";
}

// --- styles ----------------------------------------------------------------
// styleId -> heading level. Both the id ("Heading2") and the display name
// ("heading 2") are checked: localised templates keep the English id but a few
// generators do the reverse.
function headingLevels(stylesXml: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!stylesXml) return out;
  const doc = parseXml(stylesXml);
  if (!doc) return out;
  const styles = doc.getElementsByTagName("w:style");
  for (let i = 0; i < styles.length; i++) {
    const s = styles.item(i) as unknown as El;
    const id = s.getAttribute("w:styleId") ?? "";
    const name = attr(kid(s, "w:name"), "w:val") ?? "";
    const m =
      /^heading\s*([1-9])$/i.exec(id) ?? /^heading\s*([1-9])$/i.exec(name);
    if (m?.[1]) out.set(id, Math.min(6, Number(m[1])));
  }
  return out;
}

// numId -> (level -> "bullet" | "number"). Word stores the format one hop away:
// w:num maps a numId to an abstractNumId, and the abstract definition holds the
// per-level w:numFmt.
function numberingKinds(
  numberingXml: string | undefined,
): Map<string, Map<number, "bullet" | "number">> {
  const out = new Map<string, Map<number, "bullet" | "number">>();
  if (!numberingXml) return out;
  const doc = parseXml(numberingXml);
  if (!doc) return out;
  const abstract = new Map<string, Map<number, "bullet" | "number">>();
  const defs = doc.getElementsByTagName("w:abstractNum");
  for (let i = 0; i < defs.length; i++) {
    const d = defs.item(i) as unknown as El;
    const id = d.getAttribute("w:abstractNumId") ?? "";
    const levels = new Map<number, "bullet" | "number">();
    for (const lvl of kids(d, "w:lvl")) {
      const ilvl = num(lvl.getAttribute("w:ilvl")) ?? 0;
      const fmt = attr(kid(lvl, "w:numFmt"), "w:val") ?? "";
      levels.set(ilvl, fmt === "bullet" ? "bullet" : "number");
    }
    abstract.set(id, levels);
  }
  const nums = doc.getElementsByTagName("w:num");
  for (let i = 0; i < nums.length; i++) {
    const n = nums.item(i) as unknown as El;
    const numId = n.getAttribute("w:numId") ?? "";
    const absId = attr(kid(n, "w:abstractNumId"), "w:val") ?? "";
    const levels = abstract.get(absId);
    if (levels) out.set(numId, levels);
  }
  return out;
}

function parseXml(xml: string): Document | null {
  if (!xml.trim()) return null;
  try {
    // xmldom reports malformed input through a handler rather than by throwing;
    // silence it and detect failure by what comes back.
    const noop = () => {};
    const doc = new DOMParser({
      errorHandler: { warning: noop, error: noop, fatalError: noop },
    }).parseFromString(xml, "text/xml") as unknown as Document;
    return doc?.documentElement ? doc : null;
  } catch {
    return null;
  }
}

// --- runs ------------------------------------------------------------------
function readRun(r: El, images: Record<string, string>): DocxInline[] {
  const out: DocxInline[] = [];
  const pr = kid(r, "w:rPr");

  const style: Omit<DocxTextRun, "kind" | "text"> = {};
  if (pr) {
    const b = onOff(kid(pr, "w:b"));
    if (b) style.bold = true;
    const i = onOff(kid(pr, "w:i"));
    if (i) style.italic = true;
    const u = kid(pr, "w:u");
    if (u && (u.getAttribute("w:val") ?? "single") !== "none") {
      style.underline = true;
    }
    if (onOff(kid(pr, "w:strike"))) style.strike = true;
    const c = color(attr(kid(pr, "w:color"), "w:val"));
    if (c) style.color = c;
    const hl = color(attr(kid(pr, "w:shd"), "w:fill"));
    if (hl) style.highlight = hl;
    // w:sz is half-points. 200pt is already poster-sized; beyond that the
    // document is broken and a single run would blow out the page.
    const sz = num(attr(kid(pr, "w:sz"), "w:val"));
    const pt = sz === undefined ? undefined : len(sz / 2, 200);
    if (pt !== undefined) style.size = pt;
    const f = fontName(attr(kid(pr, "w:rFonts"), "w:ascii"));
    if (f) style.font = f;
    const va = attr(kid(pr, "w:vertAlign"), "w:val");
    if (va === "superscript") style.vertAlign = "super";
    if (va === "subscript") style.vertAlign = "sub";
  }

  const push = (text: string) => {
    if (text) out.push({ kind: "text", text, ...style });
  };

  for (const c of childElements(r)) {
    switch (c.nodeName) {
      case "w:t":
        push(c.textContent ?? "");
        break;
      case "w:tab":
        push("\t");
        break;
      case "w:br":
        out.push({ kind: "text", text: "\n", ...style });
        break;
      case "w:drawing":
      case "w:pict": {
        const img = readImage(c, images);
        if (img) out.push(img);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function readImage(
  el: El,
  images: Record<string, string>,
): DocxImageRun | null {
  const blip = firstDeep(el, "a:blip") ?? firstDeep(el, "v:imagedata");
  const id = attr(blip, "r:embed") ?? attr(blip, "r:id");
  // An unknown relationship means the part is missing or was filtered out for
  // being an unsupported type -- render nothing rather than a broken image.
  const src = id ? images[id] : undefined;
  if (!src) return null;
  const extent = firstDeep(el, "wp:extent");
  const cx = num(attr(extent, "cx"));
  const cy = num(attr(extent, "cy"));
  const alt = attr(firstDeep(el, "wp:docPr"), "descr") ?? undefined;
  const img: DocxImageRun = { kind: "image", src };
  const w = cx === undefined ? undefined : len(emuToPt(cx), 2000);
  const h = cy === undefined ? undefined : len(emuToPt(cy), 2000);
  if (w !== undefined) img.width = w;
  if (h !== undefined) img.height = h;
  if (alt) img.alt = alt;
  return img;
}

// --- paragraphs ------------------------------------------------------------
interface Ctx {
  headings: Map<string, number>;
  numbering: Map<string, Map<number, "bullet" | "number">>;
  images: Record<string, string>;
}

function readParagraph(p: El, ctx: Ctx): DocxParagraph {
  const pr = kid(p, "w:pPr");
  const out: DocxParagraph = { kind: "p", runs: [] };

  for (const c of childElements(p)) {
    if (c.nodeName === "w:r") out.runs.push(...readRun(c, ctx.images));
    // A hyperlink wraps its own runs; the text matters, the target does not
    // (the viewer has no browser pane and an untrusted link is a phishing
    // surface, so links were never clickable here).
    else if (c.nodeName === "w:hyperlink") {
      for (const r of kids(c, "w:r")) out.runs.push(...readRun(r, ctx.images));
    }
  }
  if (!pr) return out;

  const jc = attr(kid(pr, "w:jc"), "w:val");
  if (jc === "center" || jc === "right" || jc === "left") out.align = jc;
  else if (jc === "both" || jc === "distribute") out.align = "justify";

  const styleId = attr(kid(pr, "w:pStyle"), "w:val") ?? "";
  // styles.xml is the authority (it carries localised display names), but fall
  // back to the id itself: a document can reference "Heading2" without shipping
  // a style definition for it, and dropping the level would flatten the whole
  // outline to body text.
  const idLevel = /^heading\s*([1-9])$/i.exec(styleId)?.[1];
  const level =
    ctx.headings.get(styleId) ??
    (idLevel ? Math.min(6, Number(idLevel)) : undefined);
  if (level) out.heading = level;

  const spacing = kid(pr, "w:spacing");
  const before = len(twipToPt(num(attr(spacing, "w:before")) ?? 0), 200);
  const after = len(twipToPt(num(attr(spacing, "w:after")) ?? 0), 200);
  if (before !== undefined) out.spaceBefore = before;
  if (after !== undefined) out.spaceAfter = after;

  const ind = kid(pr, "w:ind");
  const left = len(twipToPt(num(attr(ind, "w:left")) ?? 0), 400);
  if (left !== undefined) out.indent = left;

  // The rule under the title block is a paragraph bottom BORDER, not an <hr>.
  const bottom = kid(kid(pr, "w:pBdr"), "w:bottom");
  if (bottom && (bottom.getAttribute("w:val") ?? "single") !== "none") {
    out.rule = true;
  }

  const numPr = kid(pr, "w:numPr");
  if (numPr) {
    const numId = attr(kid(numPr, "w:numId"), "w:val") ?? "";
    const ilvl = num(attr(kid(numPr, "w:ilvl"), "w:val")) ?? 0;
    const kind = ctx.numbering.get(numId)?.get(ilvl) ?? "bullet";
    out.list = { kind, level: Math.min(8, Math.max(0, ilvl)) };
  } else if (/^List(Bullet|Paragraph)/i.test(styleId)) {
    out.list = { kind: "bullet", level: 0 };
  } else if (/^ListNumber/i.test(styleId)) {
    out.list = { kind: "number", level: 0 };
  }

  return out;
}

function readTable(tbl: El, ctx: Ctx): DocxTable {
  const rows: DocxRow[] = [];
  for (const tr of kids(tbl, "w:tr")) {
    const cells: DocxCell[] = [];
    for (const tc of kids(tr, "w:tc")) {
      const pr = kid(tc, "w:tcPr");
      const cell: DocxCell = { blocks: readBlocks(tc, ctx) };
      const shade = color(attr(kid(pr, "w:shd"), "w:fill"));
      if (shade) cell.shade = shade;
      const tcW = kid(pr, "w:tcW");
      if (attr(tcW, "w:type") === "dxa") {
        const w = len(twipToPt(num(attr(tcW, "w:w")) ?? 0), 2000);
        if (w !== undefined) cell.width = w;
      }
      const span = num(attr(kid(pr, "w:gridSpan"), "w:val"));
      if (span && span > 1) cell.colSpan = Math.min(64, span);
      cells.push(cell);
    }
    const header = kid(kid(tr, "w:trPr"), "w:tblHeader") !== undefined;
    rows.push(header ? { cells, header: true } : { cells });
  }
  return { kind: "table", rows };
}

// Direct children only -- see childElements.
function readBlocks(parent: El, ctx: Ctx): DocxBlock[] {
  const out: DocxBlock[] = [];
  for (const c of childElements(parent)) {
    if (c.nodeName === "w:p") out.push(readParagraph(c, ctx));
    else if (c.nodeName === "w:tbl") out.push(readTable(c, ctx));
  }
  return out;
}

function readPage(body: El | undefined): DocxPage {
  const sect = body ? kid(body, "w:sectPr") : undefined;
  if (!sect) return LETTER;
  const sz = kid(sect, "w:pgSz");
  const mar = kid(sect, "w:pgMar");
  const width = len(twipToPt(num(attr(sz, "w:w")) ?? 0), 5000) ?? LETTER.width;
  const side = (name: string, fallback: number) =>
    len(twipToPt(num(attr(mar, name)) ?? 0), 400) ?? fallback;
  return {
    width,
    margin: {
      top: side("w:top", LETTER.margin.top),
      right: side("w:right", LETTER.margin.right),
      bottom: side("w:bottom", LETTER.margin.bottom),
      left: side("w:left", LETTER.margin.left),
    },
  };
}

export function parseDocx(src: DocxSource): DocxDoc {
  const doc = parseXml(src.documentXml);
  const body = doc
    ? kid(doc.documentElement as unknown as El, "w:body")
    : undefined;
  if (!body) return { blocks: [], page: LETTER };
  const ctx: Ctx = {
    headings: headingLevels(src.stylesXml),
    numbering: numberingKinds(src.numberingXml),
    images: src.images ?? {},
  };
  return { blocks: readBlocks(body, ctx), page: readPage(body) };
}
