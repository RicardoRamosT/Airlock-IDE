// Turn the HTML mammoth produced from a .docx into React elements WITHOUT
// ever injecting markup.
//
// A Word document is untrusted input, so `dangerouslySetInnerHTML` is not on
// the table -- one crafted document should not be able to put arbitrary nodes
// in the app's DOM. Instead the string is parsed with DOMParser (which builds
// an inert document: no scripts run, no resources load) and only an ALLOW-LIST
// of elements is rebuilt. Anything unrecognised contributes its text and
// nothing else, so unknown markup degrades to prose rather than disappearing.
import { createElement, type ReactNode } from "react";

// What mammoth actually emits, plus the inline marks it uses. Anything outside
// this set is unwrapped rather than rendered.
const ALLOWED = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "sup",
  "sub",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "blockquote",
  "pre",
  "code",
  "img",
  "a",
]);

// Void elements take no children.
const VOID = new Set(["br", "img"]);

// An image must be self-contained. Mammoth inlines them as data: URIs, so a
// remote src means the document is trying to reach the network -- which the
// CSP would block anyway, but dropping it here means no request is even
// attempted and no tracking pixel can phone home.
const safeImgSrc = (src: string): string | null =>
  src.startsWith("data:image/") ? src : null;

// Links are rendered as plain text: the app has no browser pane, and a
// clickable target from an untrusted document is a phishing surface. The label
// still reads normally, and the href is appended so the destination is visible
// rather than hidden behind text.
function linkText(el: Element): string {
  const href = el.getAttribute("href") ?? "";
  const text = el.textContent ?? "";
  if (!href || href === text) return text;
  return `${text} (${href})`;
}

function convert(node: Node, key: string): ReactNode {
  if (node.nodeType === 3 /* text */) return node.nodeValue;
  if (node.nodeType !== 1 /* element */) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "a") return linkText(el);

  const kids = () =>
    [...el.childNodes].map((c, i) => convert(c, `${key}.${i}`)).filter(Boolean);

  if (!ALLOWED.has(tag)) {
    // Unknown element: keep what it said, drop what it was.
    return kids();
  }

  if (tag === "img") {
    const src = safeImgSrc(el.getAttribute("src") ?? "");
    if (!src) return null;
    return createElement("img", {
      key,
      src,
      alt: el.getAttribute("alt") ?? "",
    });
  }

  if (VOID.has(tag)) return createElement(tag, { key });

  // NOTE: no attributes are carried over except an image's vetted src. Word
  // style attributes are not worth the injection surface, and the viewer's own
  // stylesheet is what makes the document readable in the app's theme.
  return createElement(tag, { key }, ...kids());
}

export function docxHtmlToReact(html: string): ReactNode[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.body.childNodes]
    .map((n, i) => convert(n, `n${i}`))
    .filter(Boolean);
}

// True for paths the inline document viewer should handle (by extension).
// .doc (the old binary format) is deliberately absent: mammoth reads the OOXML
// zip only, and claiming support would give a blank page instead of the
// binary notice that at least offers to open it elsewhere.
const DOC_EXTS = new Set(["docx"]);
export function isDocxPath(relPath: string): boolean {
  const i = relPath.lastIndexOf(".");
  if (i < 0) return false;
  return DOC_EXTS.has(relPath.slice(i + 1).toLowerCase());
}
