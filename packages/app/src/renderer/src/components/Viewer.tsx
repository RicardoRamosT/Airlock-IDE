import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { unifiedMergeView } from "@codemirror/merge";
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
  const { selectedFile, file, setSelected, diff, setDiff } = useApp();
  const theme = useApp((s) => s.theme);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || (!file && !diff)) return;
    const docText = diff ? diff.modified : (file?.content ?? "");
    const pathForLang = diff ? diff.path : selectedFile;
    const key = pathForLang ? languageKeyForPath(pathForLang) : null;
    const view = new EditorView({
      state: EditorState.create({
        doc: docText,
        extensions: [
          basicSetup,
          // oneDark only in dark mode; CM6's built-in default theme is
          // light and reads on the white [data-theme=light] background. The
          // view is recreated on theme change (added to the deps below) so the
          // editor swaps palettes with the rest of the UI.
          ...(theme === "dark" ? [oneDark] : []),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false), // viewer semantics: contenteditable off (closes IME mutation path)
          EditorView.theme({ "&": { height: "100%" } }),
          ...(key ? [LANGUAGES[key]()] : []),
          ...(diff
            ? [
                unifiedMergeView({
                  original: diff.original,
                  mergeControls: false,
                }),
              ]
            : []),
        ],
      }),
      parent: host,
    });
    return () => view.destroy();
  }, [selectedFile, file, diff, theme]);

  if (!file && !diff) return <div className="empty">select a file</div>;
  return (
    <div className="viewer">
      <div className="viewer-header">
        <span>{diff ? diff.path : selectedFile}</span>
        {diff && <span className="badge">{diff.which} diff</span>}
        {!diff && file?.truncated && (
          <span className="badge">truncated · first 1 MB</span>
        )}
        {!diff && (
          <span className="badge dim-badge">read-only · editing in week 6</span>
        )}
        <button
          type="button"
          className="viewer-close"
          onClick={() => (diff ? setDiff(null) : setSelected(null, null))}
          title="Close viewer (back to full terminal)"
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
      <div ref={hostRef} className="viewer-host" />
    </div>
  );
}
