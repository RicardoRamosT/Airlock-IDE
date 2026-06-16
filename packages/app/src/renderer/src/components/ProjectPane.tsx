import { useCallback, useEffect, useState } from "react";
import type { FileContent } from "../../../shared/ipc";
import { isImagePath } from "../lib/imageTypes";
import { ProjectPaneContext } from "../lib/projectPane";
import { useTerminalSlots } from "../lib/terminalSlots";
import { useApp } from "../store";
import { BinaryNotice } from "./BinaryNotice";
import { DataGrid } from "./DataGrid";
import { EditorPane } from "./EditorPane";
import { ImagePreview } from "./ImagePreview";
import { MainTabs } from "./MainTabs";
import { Viewer } from "./Viewer";

// One project's unified main area scoped to a single tab (the window's single
// sidebar lives in App, beside the activity bar -- panes no longer carry one).
// The main area is a unified tab bar (terminals + open files) over a content
// region. The region shows the PRIMARY pane (the selected tab) and, when split,
// a SECONDARY pane beside it -- each can be a terminal or a file editor, so any
// combo splits (term|term, file|file, file|term). Git diff / Settings / DB are
// full overlays on top, with the tab bar persisting.
//
// Terminals render through TerminalManager's per-tab portal into the single
// `pane-terminal-slot`; ProjectTerminals shows the right 0/1/2 terminals (driven
// by mainPrimary/mainSecondary). The slot is placed full (both panes terminals,
// or single terminal), or in one sub-pane (a file + a terminal); when no
// terminal is on screen the slot is absent and the ptys keep-alive.
export function ProjectPane({
  tabId,
  focused,
}: {
  tabId: string;
  focused: boolean;
}) {
  const { register, unregister } = useTerminalSlots();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const selectedFile = useApp((s) => s.tabState[tabId]?.selectedFile ?? null);
  const diff = useApp((s) => s.tabState[tabId]?.diff ?? null);
  const dbView = useApp((s) => s.tabState[tabId]?.dbView ?? null);
  const mainPrimary = useApp(
    (s) => s.tabState[tabId]?.mainPrimary ?? "terminal",
  );
  const mainSecondary = useApp((s) => s.tabState[tabId]?.mainSecondary ?? null);
  const theme = useApp((s) => s.theme);

  // The shown scene's file panes load their content on demand: the PRIMARY
  // (left) editor when mainPrimary is "editor", and the SECONDARY (right) pane
  // when it is a file. (The store no longer caches file content -- `current` can
  // become any file by clicking its tab.)
  const primaryPath = mainPrimary === "editor" ? selectedFile : null;
  const [primaryContent, setPrimaryContent] = useState<FileContent | null>(
    null,
  );
  useEffect(() => {
    if (!primaryPath || !root) {
      setPrimaryContent(null);
      return;
    }
    let cancelled = false;
    setPrimaryContent(null);
    window.airlock
      .readFile(root, primaryPath)
      .then((f) => {
        if (!cancelled) setPrimaryContent(f);
      })
      .catch((e) => console.error("read primary file failed", e));
    return () => {
      cancelled = true;
    };
  }, [primaryPath, root]);

  const secPath = mainSecondary?.kind === "file" ? mainSecondary.path : null;
  const [secContent, setSecContent] = useState<FileContent | null>(null);
  useEffect(() => {
    if (!secPath || !root) {
      setSecContent(null);
      return;
    }
    let cancelled = false;
    setSecContent(null);
    window.airlock
      .readFile(root, secPath)
      .then((f) => {
        if (!cancelled) setSecContent(f);
      })
      .catch((e) => console.error("read secondary file failed", e));
    return () => {
      cancelled = true;
    };
  }, [secPath, root]);

  const slotRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      register(tabId, el);
      return () => unregister(tabId, el);
    },
    [tabId, register, unregister],
  );

  const focus = () => useApp.getState().switchTab(tabId);

  const overlay = !!dbView || !!diff;
  // The primary pane is an editor only when an editor file is the primary; else
  // it is the terminal.
  const primaryEditorPath =
    mainPrimary === "editor" && selectedFile ? selectedFile : null;
  const bothTerminals =
    !overlay && !primaryEditorPath && mainSecondary?.kind === "terminal";

  // The single terminal slot (placed full, or in one sub-pane). Reused across
  // branches but only rendered once per layout.
  const slot = (
    <div className="terminal-slot pane-terminal-slot" ref={slotRef} />
  );
  const editorArea = (relPath: string, content: FileContent | null) => (
    <div className="editor-area">
      {root && content ? (
        isImagePath(relPath) ? (
          <ImagePreview key={relPath} root={root} relPath={relPath} />
        ) : content.binary ? (
          <BinaryNotice
            key={relPath}
            root={root}
            relPath={relPath}
            size={content.size}
          />
        ) : (
          <EditorPane
            key={relPath}
            tabId={tabId}
            root={root}
            relPath={relPath}
            file={content}
            theme={theme}
          />
        )
      ) : (
        <div className="empty">loading…</div>
      )}
    </div>
  );

  const leftPane = primaryEditorPath
    ? editorArea(primaryEditorPath, primaryContent)
    : slot;
  const rightPane =
    mainSecondary == null
      ? null
      : mainSecondary.kind === "terminal"
        ? slot
        : editorArea(mainSecondary.path, secContent);

  let content: React.ReactNode;
  if (dbView) content = <DataGrid />;
  else if (diff) content = <Viewer />;
  else if (bothTerminals)
    content = slot; // ProjectTerminals shows both
  else if (mainSecondary == null) content = leftPane;
  else
    content = (
      <>
        {leftPane}
        {rightPane}
      </>
    );

  const split = !overlay && !bothTerminals && mainSecondary != null;

  return (
    <ProjectPaneContext.Provider value={tabId}>
      <div
        className={`project-pane${focused ? " focused" : ""}`}
        onFocusCapture={focus}
        onMouseDownCapture={focus}
      >
        <div className="main">
          <MainTabs tabId={tabId} />
          <div className={`main-content${split ? " main-panes split" : ""}`}>
            {content}
          </div>
        </div>
      </div>
    </ProjectPaneContext.Provider>
  );
}
