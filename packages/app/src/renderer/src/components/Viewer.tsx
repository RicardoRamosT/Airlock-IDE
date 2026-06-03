import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { type LanguageKey, languageKeyForPath } from "../lib/language";
import { useApp } from "../store";

const LANGUAGES: Record<LanguageKey, () => Extension> = {
  js: () => javascript({ jsx: true, typescript: true }),
  json: () => json(),
  md: () => markdown(),
  css: () => css(),
  html: () => html(),
};

export function Viewer() {
  const { selectedFile, file, setSelected } = useApp();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !file) return;
    const key = selectedFile ? languageKeyForPath(selectedFile) : null;
    const view = new EditorView({
      state: EditorState.create({
        doc: file.content,
        extensions: [
          basicSetup,
          oneDark,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false), // viewer semantics: contenteditable off (closes IME mutation path)
          EditorView.theme({ "&": { height: "100%" } }),
          ...(key ? [LANGUAGES[key]()] : []),
        ],
      }),
      parent: host,
    });
    return () => view.destroy();
  }, [selectedFile, file]);

  if (!file) return <div className="empty">select a file</div>;
  return (
    <div className="viewer">
      <div className="viewer-header">
        <span>{selectedFile}</span>
        {file.truncated && (
          <span className="badge">truncated · first 1 MB</span>
        )}
        <span className="badge dim-badge">read-only · editing in week 6</span>
        <button
          type="button"
          className="viewer-close"
          onClick={() => setSelected(null, null)}
          title="Close viewer (back to full terminal)"
        >
          ✕
        </button>
      </div>
      <div ref={hostRef} className="viewer-host" />
    </div>
  );
}
