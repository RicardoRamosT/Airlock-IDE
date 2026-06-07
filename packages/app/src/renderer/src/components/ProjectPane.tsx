import { useCallback, useEffect, useState } from "react";
import type { FileContent } from "../../../shared/ipc";
import { ProjectPaneContext } from "../lib/projectPane";
import { useTerminalSlots } from "../lib/terminalSlots";
import { useApp } from "../store";
import { DataGrid } from "./DataGrid";
import { EditorPane } from "./EditorPane";
import { MainTabs } from "./MainTabs";
import { SettingsTab } from "./SettingsTab";
import { Sidebar } from "./Sidebar";
import { Viewer } from "./Viewer";

// One full project view (Sidebar + a unified main area) scoped to a single tab.
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
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const selectedFile = useApp((s) => s.tabState[tabId]?.selectedFile ?? null);
  const file = useApp((s) => s.tabState[tabId]?.file ?? null);
  const diff = useApp((s) => s.tabState[tabId]?.diff ?? null);
  const settingsOpen = useApp((s) => s.tabState[tabId]?.settingsOpen ?? false);
  const dbView = useApp((s) => s.tabState[tabId]?.dbView ?? null);
  const mainPrimary = useApp(
    (s) => s.tabState[tabId]?.mainPrimary ?? "terminal",
  );
  const mainSecondary = useApp((s) => s.tabState[tabId]?.mainSecondary ?? null);
  // Scene override: when set, this single item is shown full-screen on top of
  // the (preserved) split.
  const mainSolo = useApp((s) => s.tabState[tabId]?.mainSolo ?? null);
  const theme = useApp((s) => s.theme);

  // The primary editor uses store.file (loaded by openFile); the SECONDARY pane
  // and the SOLO override each load their file content here on demand.
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

  const soloPath = mainSolo?.kind === "file" ? mainSolo.path : null;
  const [soloContent, setSoloContent] = useState<FileContent | null>(null);
  useEffect(() => {
    if (!soloPath || !root) {
      setSoloContent(null);
      return;
    }
    let cancelled = false;
    setSoloContent(null);
    window.airlock
      .readFile(root, soloPath)
      .then((f) => {
        if (!cancelled) setSoloContent(f);
      })
      .catch((e) => console.error("read solo file failed", e));
    return () => {
      cancelled = true;
    };
  }, [soloPath, root]);

  const slotRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      register(tabId, el);
      return () => unregister(tabId, el);
    },
    [tabId, register, unregister],
  );

  const focus = () => useApp.getState().switchTab(tabId);

  const overlay = !!dbView || settingsOpen || !!diff;
  // The primary pane is an editor only when an editor file is the primary; else
  // it is the terminal.
  const primaryEditorPath =
    mainPrimary === "editor" && selectedFile ? selectedFile : null;
  const bothTerminals =
    !overlay &&
    !mainSolo &&
    !primaryEditorPath &&
    mainSecondary?.kind === "terminal";

  // The single terminal slot (placed full, or in one sub-pane). Reused across
  // branches but only rendered once per layout.
  const slot = (
    <div className="terminal-slot pane-terminal-slot" ref={slotRef} />
  );
  const editorArea = (relPath: string, content: FileContent | null) => (
    <div className="editor-area">
      {root && content ? (
        <EditorPane
          key={relPath}
          root={root}
          relPath={relPath}
          file={content}
          theme={theme}
        />
      ) : (
        <div className="empty">loading…</div>
      )}
    </div>
  );

  const leftPane = primaryEditorPath
    ? editorArea(primaryEditorPath, file)
    : slot;
  const rightPane =
    mainSecondary == null
      ? null
      : mainSecondary.kind === "terminal"
        ? slot
        : editorArea(mainSecondary.path, secContent);

  let content: React.ReactNode;
  if (dbView) content = <DataGrid />;
  else if (settingsOpen) content = <SettingsTab />;
  else if (diff) content = <Viewer />;
  // Scene override: show just the solo item full-screen (the split is preserved
  // but hidden). A solo terminal uses the slot; a solo file loads its own content.
  else if (mainSolo)
    content =
      mainSolo.kind === "terminal"
        ? slot
        : editorArea(mainSolo.path, soloContent);
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

  const split =
    !overlay && !mainSolo && !bothTerminals && mainSecondary != null;

  return (
    <ProjectPaneContext.Provider value={tabId}>
      <div
        className={`project-pane${focused ? " focused" : ""}`}
        onFocusCapture={focus}
        onMouseDownCapture={focus}
      >
        <div
          className={`layout${sidebarPosition === "right" ? " sidebar-right" : ""}${sidebarVisible ? "" : " sidebar-hidden"}`}
        >
          <Sidebar />
          <div className="main">
            <MainTabs tabId={tabId} />
            <div className={`main-content${split ? " main-panes split" : ""}`}>
              {content}
            </div>
          </div>
        </div>
      </div>
    </ProjectPaneContext.Provider>
  );
}
