import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { languageExtensionForPath } from "../lib/language";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

// The git DIFF overlay: a READ-ONLY two-side comparison. File EDITING is handled
// by EditorPane (rendered directly by ProjectPane); this component is shown only
// when a diff is set on the pane.
export function Viewer() {
  const tabId = useProjectTab();
  const diff = useApp((s) => s.tabState[tabId]?.diff ?? null);
  const setDiff = useApp((s) => s.setDiff);
  const theme = useApp((s) => s.theme);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!diff) return;
    const host = hostRef.current;
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

  if (!diff) return <div className="empty">select a file</div>;
  return (
    <div className="viewer">
      <div className="viewer-header">
        <span>{diff.path}</span>
        <span className="badge">{diff.which} diff</span>
        <button
          type="button"
          className="viewer-close"
          onClick={() => setDiff(null, tabId)}
          title="Close diff (back to the editor)"
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
      <div ref={hostRef} className="viewer-host" />
    </div>
  );
}
