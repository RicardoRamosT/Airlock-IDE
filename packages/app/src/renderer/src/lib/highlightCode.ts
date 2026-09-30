// highlightCode.ts
// Static syntax highlighting for a fenced code block in the markdown preview,
// using the SAME Lezer grammars the editor already ships (lib/language.ts), so
// no second highlighter is bundled and the token set matches the editor's.
//
// Output is plain {text, cls} spans the React side renders as text nodes, so a
// code block can never inject markup however hostile its contents.

import type { Parser } from "@lezer/common";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import { type LanguageKey, languageSupportFor } from "./language";

// A fence's info string -> the editor's language key. Only languages with a
// bundled grammar are listed; anything else renders plain.
const FENCE_LANGS: Record<string, LanguageKey> = {
  js: "js",
  javascript: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  ts: "js",
  typescript: "js",
  tsx: "js",
  json: "json",
  jsonc: "json",
  css: "css",
  html: "html",
  htm: "html",
  md: "md",
  markdown: "md",
};

export interface CodeSpan {
  text: string;
  /** Space-separated `tok-*` classes, or "" for unstyled text. */
  cls: string;
}

const parsers = new Map<LanguageKey, Parser>();
function parserFor(key: LanguageKey): Parser {
  let p = parsers.get(key);
  if (!p) {
    p = languageSupportFor(key).language.parser;
    parsers.set(key, p);
  }
  return p;
}

// null = no grammar for this fence; the caller renders the code unstyled.
export function highlightSpans(
  code: string,
  lang: string | null,
): CodeSpan[] | null {
  const key = lang ? FENCE_LANGS[lang.trim().toLowerCase()] : undefined;
  if (!key) return null;
  const tree = parserFor(key).parse(code);
  const out: CodeSpan[] = [];
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, cls) => out.push({ text, cls }),
    () => out.push({ text: "\n", cls: "" }),
  );
  return out;
}
