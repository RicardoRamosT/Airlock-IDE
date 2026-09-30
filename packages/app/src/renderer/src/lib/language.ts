import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import type { LanguageSupport } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

export type LanguageKey = "js" | "json" | "md" | "css" | "html" | "yaml";

const BY_EXT: Record<string, LanguageKey> = {
  js: "js",
  jsx: "js",
  ts: "js",
  tsx: "js",
  mjs: "js",
  cjs: "js",
  json: "json",
  md: "md",
  markdown: "md",
  css: "css",
  html: "html",
  htm: "html",
  yml: "yaml",
  yaml: "yaml",
};

export function languageKeyForPath(path: string): LanguageKey | null {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  // <= 0 (not === -1) intentionally rejects leading-dot names like ".env" too
  if (dot <= 0) return null;
  return BY_EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}

const LANGUAGES: Record<LanguageKey, () => LanguageSupport> = {
  js: () => javascript({ jsx: true, typescript: true }),
  json: () => json(),
  md: () => markdown(),
  css: () => css(),
  html: () => html(),
  yaml: () => yaml(),
};

// The language itself, for callers that need its parser rather than an editor
// extension (the markdown preview's static code-fence highlighting).
export function languageSupportFor(key: LanguageKey): LanguageSupport {
  return LANGUAGES[key]();
}

// CodeMirror language extension(s) for a path's file type, or [] for unknown.
// Shared by the editable EditorPane and the read-only diff view.
export function languageExtensionForPath(path: string | null): Extension[] {
  const key = path ? languageKeyForPath(path) : null;
  return key ? [LANGUAGES[key]()] : [];
}
