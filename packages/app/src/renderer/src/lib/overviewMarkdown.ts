// overviewMarkdown.ts
// A small, dependency-free renderer for the OVERVIEW markdown subset only.
// The model holds raw strings; the React renderer (OverviewMarkdown.tsx) emits
// text nodes, so embedded HTML is inert (no dangerouslySetInnerHTML anywhere).
export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; v: string }
  | { t: "em"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; href: string; text: string };

export type Block =
  | { t: "heading"; level: number; spans: Inline[] }
  | { t: "paragraph"; spans: Inline[] }
  | { t: "list"; ordered: boolean; items: Inline[][] }
  | { t: "code"; lang: string | null; v: string };

// Allow http(s) and scheme-less (relative path / #anchor) hrefs; reject any
// other URI scheme (javascript:, data:, file:, vbscript:, …).
function sanitizeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  return h;
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
      out.push({ t: "code", v: mCode[1] });
      i += mCode[0].length;
      continue;
    }
    const mLink = /^\[([^\]]*)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/.exec(
      rest,
    );
    if (mLink) {
      const href = sanitizeHref(mLink[2]);
      if (href) out.push({ t: "link", href, text: mLink[1] });
      else pushText(out, mLink[1]);
      i += mLink[0].length;
      continue;
    }
    const mStrong = /^\*\*([^*]+)\*\*/.exec(rest);
    if (mStrong) {
      out.push({ t: "strong", v: mStrong[1] });
      i += mStrong[0].length;
      continue;
    }
    const mEm = /^\*([^*]+)\*/.exec(rest) ?? /^_([^_]+)_/.exec(rest);
    if (mEm) {
      out.push({ t: "em", v: mEm[1] });
      i += mEm[0].length;
      continue;
    }
    pushText(out, src[i]);
    i += 1;
  }
  return out;
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
    const line = lines[i];

    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      flushPara();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i += 1; // skip closing fence
      blocks.push({
        t: "code",
        lang: fence[1].trim() || null,
        v: buf.join("\n"),
      });
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      blocks.push({
        t: "heading",
        level: h[1].length,
        spans: parseInline(h[2].trim()),
      });
      i += 1;
      continue;
    }

    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = /\d+\./.test(li[1]);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m || /\d+\./.test(m[1]) !== ordered) break;
        items.push(parseInline(m[2]));
        i += 1;
      }
      blocks.push({ t: "list", ordered, items });
      continue;
    }

    if (line.trim() === "") {
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
