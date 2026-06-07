import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { languageExtensionForPath } from "../lib/language";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { EditorPane } from "./EditorPane";

export function Viewer() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const selectedFile = useApp((s) => s.tabState[tabId]?.selectedFile ?? null);
  const file = useApp((s) => s.tabState[tabId]?.file ?? null);
  const diff = useApp((s) => s.tabState[tabId]?.diff ?? null);
  const setSelected = useApp((s) => s.setSelected);
  const setDiff = useApp((s) => s.setDiff);
  const theme = useApp((s) => s.theme);
  const diffHostRef = useRef<HTMLDivElement>(null);

  // The diff view stays READ-ONLY (a git two-side comparison, not an editable
  // doc). Built only while a diff is shown; the editable file path goes through
  // EditorPane instead.
  useEffect(() => {
    if (!diff) return;
    const host = diffHostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: diff.modified,
        extensions: [
          basicSetup,
          ...(theme === "dark" ? [oneDark] : []),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.theme({ "&": { height: "100%" } }),
          ...languageExtensionForPath(diff.path),
          unifiedMergeView({ original: diff.original, mergeControls: false }),
        ],
      }),
      parent: host,
    });
    return () => view.destroy();
  }, [diff, theme]);

  if (diff) {
    return (
      <div className="viewer">
        <div className="viewer-header">
          <span>{diff.path}</span>
          <span className="badge">{diff.which} diff</span>
          <button
            type="button"
            className="viewer-close"
            onClick={() => setDiff(null, tabId)}
            title="Close diff (back to full terminal)"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>
        <div ref={diffHostRef} className="viewer-host" />
      </div>
    );
  }

  if (!selectedFile || !file || !root)
    return <div className="empty">select a file</div>;

  return (
    <div className="viewer">
      <div className="viewer-header">
        <span>{selectedFile}</span>
        <button
          type="button"
          className="viewer-close"
          onClick={() => setSelected(null, null, tabId)}
          title="Close file (back to full terminal)"
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
      <EditorPane
        key={selectedFile}
        root={root}
        relPath={selectedFile}
        file={file}
        theme={theme}
      />
    </div>
  );
}
