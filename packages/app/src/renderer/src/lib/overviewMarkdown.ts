// overviewMarkdown.ts
// A small, dependency-free renderer for the OVERVIEW markdown subset only.
// The model holds raw strings; the React renderer (OverviewMarkdown.tsx) emits
// text nodes, so embedded HTML is inert (no dangerouslySetInnerHTML anywhere).
export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; v: string }
  | { t: "em"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; href: string; text: string }
  | { t: "image"; src: string; alt: string }
  | { t: "imageLink"; href: string; src: string; alt: string };

// A list item with optional sub-list for nesting.
export interface ListItem {
  spans: Inline[];
  sub: { ordered: boolean; items: ListItem[] } | null;
}

export type Block =
  | { t: "heading"; level: number; spans: Inline[] }
  | { t: "paragraph"; spans: Inline[] }
  | { t: "list"; ordered: boolean; items: ListItem[] }
  | { t: "code"; lang: string | null; v: string }
  | { t: "quote"; spans: Inline[] }
  | { t: "table"; headers: Inline[][]; rows: Inline[][][] };

// Allow http(s) and scheme-less (relative path / #anchor) hrefs; reject any
// other URI scheme (javascript:, data:, file:, vbscript:, …).
export function sanitizeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  return h;
}

// Image sources. The renderer CSP is `img-src 'self' data:`, so http(s) and
// data:image/* are the schemes worth keeping (data: actually renders; remote
// degrades to alt text in the component); scheme-less paths stay as relative
// repo paths. Reject any other scheme (javascript:, file:, vbscript:, and any
// non-image data:) — same security posture as sanitizeHref.
export function sanitizeImageSrc(src: string): string | null {
  const s = src.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  return s;
}

function pushText(out: Inline[], s: string): void {
  const last = out[out.length - 1];
  if (last && last.t === "text") last.v += s;
  else out.push({ t: "text", v: s });
}

function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const mCode = /^`([^`]+)`/.exec(rest);
    if (mCode) {
      out.push({ t: "code", v: mCode[1] ?? "" });
      i += mCode[0].length;
      continue;
    }
    // Image-link: a markdown image wrapped in a link, e.g. a shields.io badge
    // `[![alt](src)](href)`. MUST be tried before the plain-link branch, whose
    // regex would otherwise grab `![alt` as the link text and leave `](href)`
    // as stray text. src and href each allow one level of balanced parens.
    const mImageLink =
      /^\[!\[([^\]]*)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/.exec(
        rest,
      );
    if (mImageLink) {
      const alt = mImageLink[1] ?? "";
      const src = sanitizeImageSrc(mImageLink[2] ?? "");
      const href = sanitizeHref(mImageLink[3] ?? "");
      if (href && src) out.push({ t: "imageLink", href, src, alt });
      else if (href) out.push({ t: "link", href, text: alt });
      else pushText(out, alt);
      i += mImageLink[0].length;
      continue;
    }
    // Standalone image `![alt](src)`. A rejected src degrades to its alt text.
    const mImage = /^!\[([^\]]*)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/.exec(
      rest,
    );
    if (mImage) {
      const alt = mImage[1] ?? "";
      const src = sanitizeImageSrc(mImage[2] ?? "");
      if (src) out.push({ t: "image", src, alt });
      else pushText(out, alt);
      i += mImage[0].length;
      continue;
    }
    // Link regex matches one level of balanced parens in the href; deeper nesting
    // truncates (rare, malformed-URL edge case). Security boundary is sanitizeHref
    // (scheme rejection), not this regex — do not widen it as a security control.
    const mLink = /^\[([^\]]*)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/.exec(
      rest,
    );
    if (mLink) {
      const href = sanitizeHref(mLink[2] ?? "");
      if (href) out.push({ t: "link", href, text: mLink[1] ?? "" });
      else pushText(out, mLink[1] ?? "");
      i += mLink[0].length;
      continue;
    }
    const mStrong = /^\*\*([^*]+)\*\*/.exec(rest);
    if (mStrong) {
      out.push({ t: "strong", v: mStrong[1] ?? "" });
      i += mStrong[0].length;
      continue;
    }
    const mEm = /^\*([^*]+)\*/.exec(rest) ?? /^_([^_]+)_/.exec(rest);
    if (mEm) {
      out.push({ t: "em", v: mEm[1] ?? "" });
      i += mEm[0].length;
      continue;
    }
    pushText(out, src[i] ?? "");
    i += 1;
  }
  return out;
}

// Split a table row on `|`, drop empty cells from leading/trailing pipes, trim.
function splitTableRow(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((_, idx, arr) => {
      // Drop the first and last element if they are empty (caused by leading/trailing |)
      if (idx === 0 && arr[0] === "") return false;
      if (idx === arr.length - 1 && arr[arr.length - 1] === "") return false;
      return true;
    });
}

// A GFM delimiter row consists only of optional leading/trailing |, dashes, colons, spaces.
function isDelimiterRow(line: string): boolean {
  return /^\|? *:?-{1,}:? *(\| *:?-{1,}:? *)+\|?$/.test(line.trim());
}

// Determine the indentation level (number of leading spaces) for a list line.
function listIndent(line: string): number {
  return line.length - line.trimStart().length;
}

// Check if a line is a list item; returns [marker, content] or null.
function matchListItem(line: string): [string, string] | null {
  const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
  if (!m) return null;
  return [m[2] ?? "", m[3] ?? ""];
}

// Recursive list parser.
// lines: the full lines array.
// start: index to begin from.
// _baseIndent: the indent level of the parent list (reserved for future multi-level signaling).
// Returns [{ ordered, items }, nextIdx].
function parseList(
  lines: string[],
  start: number,
  _baseIndent: number,
): [{ ordered: boolean; items: ListItem[] }, number] {
  const items: ListItem[] = [];
  let i = start;

  // Determine this list's indent from the first item.
  const firstLine = lines[i] ?? "";
  const thisIndent = listIndent(firstLine);
  const firstMarker = matchListItem(firstLine);
  if (!firstMarker) return [{ ordered: false, items: [] }, i];

  const ordered = /\d+\./.test(firstMarker[0]);

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") break; // blank line ends list

    const match = matchListItem(line);
    if (!match) break; // non-list line ends list

    const indent = listIndent(line);
    const isOrdered = /\d+\./.test(match[0]);

    if (indent < thisIndent) break; // dedent ends this sub-list

    if (indent > thisIndent) {
      // Deeper indent: attach as sub-list to the last item.
      // (Should not happen without a preceding item at thisIndent, but guard defensively.)
      if (items.length === 0) break;
      const [sub, nextI] = parseList(lines, i, thisIndent);
      const last = items[items.length - 1];
      if (last) last.sub = sub;
      i = nextI;
      continue;
    }

    // Same indent: sibling item — but if type changes, end this list.
    if (isOrdered !== ordered) break;

    items.push({ spans: parseInline(match[1]), sub: null });
    i += 1;

    // Peek ahead: if the next line is a deeper-indented list item, recurse.
    if (i < lines.length) {
      const nextLine = lines[i] ?? "";
      const nextMatch = matchListItem(nextLine);
      if (nextMatch && listIndent(nextLine) > thisIndent) {
        const [sub, nextI] = parseList(lines, i, thisIndent);
        const last = items[items.length - 1];
        if (last) last.sub = sub;
        i = nextI;
      }
    }
  }

  return [{ ordered, items }, i];
}

export function parseOverviewMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ t: "paragraph", spans: parseInline(para.join(" ")) });
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code block
    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      flushPara();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i] ?? ""))
        buf.push(lines[i++] ?? "");
      i += 1; // skip closing fence
      blocks.push({
        t: "code",
        lang: (fence[1] ?? "").trim() || null,
        v: buf.join("\n"),
      });
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      blocks.push({
        t: "heading",
        level: (h[1] ?? "").length,
        spans: parseInline((h[2] ?? "").trim()),
      });
      i += 1;
      continue;
    }

    // Blockquote: one or more consecutive `> …` lines
    if (/^>\s?/.test(line)) {
      flushPara();
      const quotedLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
        quotedLines.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ t: "quote", spans: parseInline(quotedLines.join(" ")) });
      continue;
    }

    // GFM table: header line with `|` followed immediately by delimiter row
    if (line.includes("|") && i + 1 < lines.length) {
      const delimLine = lines[i + 1] ?? "";
      if (isDelimiterRow(delimLine)) {
        flushPara();
        const headers = splitTableRow(line).map((cell) => parseInline(cell));
        i += 2; // skip header + delimiter
        const rows: Inline[][][] = [];
        while (i < lines.length && (lines[i] ?? "").includes("|")) {
          rows.push(
            splitTableRow(lines[i] ?? "").map((cell) => parseInline(cell)),
          );
          i += 1;
        }
        blocks.push({ t: "table", headers, rows });
        continue;
      }
    }

    // List (indent-aware, recursive)
    if (matchListItem(line)) {
      flushPara();
      const [list, nextI] = parseList(lines, i, -1);
      blocks.push({ t: "list", ordered: list.ordered, items: list.items });
      i = nextI;
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      flushPara();
      i += 1;
      continue;
    }

    // Standalone block-level HTML tag line (e.g. `<div align="center">`,
    // `</div>`, a self-closing `<img .../>`). This renderer has no HTML support,
    // so treat such a line as inert and drop it rather than printing the raw tag
    // as literal text. The alphanumeric tag-name guard keeps autolink-style
    // `<https://…>` lines (no HTML support either, but they must stay visible).
    if (/^<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*)?>$/.test(line.trim())) {
      flushPara();
      i += 1;
      continue;
    }

    para.push(line.trim());
    i += 1;
  }
  flushPara();
  return blocks;
}
