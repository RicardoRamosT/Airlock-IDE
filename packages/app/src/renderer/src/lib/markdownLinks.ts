// markdownLinks.ts
// Where a link or image in a rendered markdown FILE points. Pure, so the
// security-relevant decisions are unit-tested rather than living in JSX.
//
// Everything is resolved against the linking file's OWN folder (GitHub's rule),
// never against the project root, and nothing may escape the project: a
// rendered README is untrusted input, and `../../.ssh/id_rsa` must not become a
// file the editor opens.

const MD_EXTS = new Set(["md", "markdown"]);

// True for files the markdown preview handles. .mdx is deliberately absent: it
// embeds JSX, which a markdown renderer would print as junk.
export function isMarkdownPath(relPath: string): boolean {
  const name = relPath.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return MD_EXTS.has(name.slice(dot + 1).toLowerCase());
}

// Resolve `target` (fragment and query already stripped) relative to the folder
// of `fromFile`, both project-root-relative. A leading "/" means the project
// root, as on GitHub. Returns null for an empty target, a malformed escape, or
// anything that climbs above the root.
export function resolveRepoPath(
  fromFile: string,
  target: string,
): string | null {
  let t: string;
  try {
    t = decodeURIComponent(target.trim());
  } catch {
    return null; // malformed %-escape
  }
  if (!t) return null;
  const base = t.startsWith("/") ? [] : fromFile.split("/").slice(0, -1);
  const out: string[] = [];
  for (const seg of [...base, ...t.split("/")]) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escapes the project root
      out.pop();
    } else out.push(seg);
  }
  return out.length ? out.join("/") : null;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export type MarkdownHref =
  | { kind: "external"; url: string }
  | { kind: "file"; path: string; anchor: string | null }
  | { kind: "anchor"; id: string };

// What clicking a link does. null = nothing (an unsafe scheme or an escape):
// the link still renders as text, it just cannot navigate.
export function resolveMarkdownHref(
  fromFile: string,
  href: string,
): MarkdownHref | null {
  const h = href.trim();
  if (!h) return null;
  // http(s) only: host:openExternal (the one bridge to the browser) refuses
  // anything else in main, so offering mailto: here would be a dead click.
  if (/^https?:\/\//i.test(h)) return { kind: "external", url: h };
  if (SCHEME.test(h)) return null; // javascript:, data:, file:, mailto:, …
  if (h.startsWith("#")) {
    const id = safeDecode(h.slice(1));
    return id ? { kind: "anchor", id } : null;
  }
  const hash = h.indexOf("#");
  const anchor = hash >= 0 ? safeDecode(h.slice(hash + 1)) || null : null;
  const noHash = hash >= 0 ? h.slice(0, hash) : h;
  const q = noHash.indexOf("?");
  const pathPart = q >= 0 ? noHash.slice(0, q) : noHash;
  const path = resolveRepoPath(fromFile, pathPart);
  return path ? { kind: "file", path, anchor } : null;
}

export type MarkdownImage =
  | { kind: "repo"; path: string }
  | { kind: "data"; src: string }
  | { kind: "remote" };

// Where an image comes from. The renderer CSP is `img-src 'self' data:`, so only
// a data:image URL renders as-is; a repo image is read from disk into one; a
// remote one (shields.io badges) would be blocked, so it shows its alt text.
export function resolveMarkdownImage(
  fromFile: string,
  src: string,
): MarkdownImage | null {
  const s = src.trim();
  if (/^data:image\//i.test(s)) return { kind: "data", src: s };
  if (/^https?:/i.test(s)) return { kind: "remote" };
  if (SCHEME.test(s)) return null;
  const q = s.search(/[?#]/);
  const path = resolveRepoPath(fromFile, q >= 0 ? s.slice(0, q) : s);
  return path ? { kind: "repo", path } : null;
}

// GitHub's heading anchor: lowercase, drop everything but letters, marks,
// digits, whitespace, "_" and "-", then each whitespace character becomes "-".
// Duplicate headings are de-duplicated by the caller (GitHub appends -1, -2).
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
