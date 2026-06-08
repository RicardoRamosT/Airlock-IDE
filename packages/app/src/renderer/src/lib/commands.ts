import type { Section } from "../../../shared/ipc";
import type { AppState } from "../store";
import { closeEditorFile, openEditorFile } from "./editorFiles";
import { openPickedFolder } from "./openFolder";

export interface Command {
  id: string;
  title: string;
  run: () => void | Promise<void>;
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: "files", label: "Files" },
  { id: "secrets", label: "Secrets" },
  { id: "git", label: "Git" },
  { id: "activity", label: "Activity" },
  { id: "databases", label: "Databases" },
  { id: "docker", label: "Docker" },
  { id: "host", label: "Host" },
  { id: "audit", label: "Audit" },
];

// Build the v1 command set from a live store snapshot. `goToFiles` switches the
// open palette to files mode (injected by the Palette so this stays UI-agnostic).
export function buildCommands(s: AppState, goToFiles: () => void): Command[] {
  const cmds: Command[] = [
    { id: "go-to-file", title: "Go to File", run: goToFiles },
    {
      id: "find-in-files",
      title: "Find in Files",
      run: () => s.setSearchOpen(true),
    },
    {
      id: "open-folder",
      title: "Open Folder...",
      run: async () => {
        const picked = await window.airlock.openFolder();
        if (picked) await openPickedFolder(picked);
      },
    },
    {
      id: "open-file",
      title: "Open File...",
      run: async () => {
        const rel = await window.airlock.openFile();
        if (rel) await openEditorFile(s.activeTabId, rel);
      },
    },
    { id: "new-tab", title: "New Tab", run: () => s.openBlankTab() },
    {
      id: "new-terminal",
      title: "New Terminal",
      run: () => {
        s.addTerminal(s.activeTabId);
      },
    },
    {
      id: "split-view",
      title: "Split View (New Terminal)",
      run: () => {
        const cur = s.current;
        if (!cur) {
          s.addTerminal(s.activeTabId);
          return;
        }
        s.splitItems(
          cur,
          { kind: "terminal", id: s.addTerminal(s.activeTabId) },
          s.activeTabId,
        );
      },
    },
    {
      id: "close-editor",
      title: "Close Editor",
      run: async () => {
        if (s.diff) s.setDiff(null);
        else if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.dbView) s.setDbView(null);
        else if (s.selectedFile)
          await closeEditorFile(s.activeTabId, s.selectedFile);
      },
    },
    {
      id: "close-folder",
      title: "Close Folder",
      run: async () => {
        await window.airlock.workspaceClose();
        s.setRoot(null);
      },
    },
    {
      id: "toggle-sidebar",
      title: "Toggle Sidebar",
      run: () => s.toggleSidebar(),
    },
    {
      id: "move-sidebar",
      title: "Move Sidebar (Left/Right)",
      run: () => s.toggleSidebarPosition(),
    },
    {
      id: "theme-dark",
      title: "Switch Theme: Dark",
      run: () => {
        s.setTheme("dark");
        void window.airlock.prefsSet({ theme: "dark" });
      },
    },
    {
      id: "theme-light",
      title: "Switch Theme: Light",
      run: () => {
        s.setTheme("light");
        void window.airlock.prefsSet({ theme: "light" });
      },
    },
  ];
  for (const sec of SECTIONS) {
    const visible = s.sectionVisibility[sec.id];
    cmds.push({
      id: `toggle-section-${sec.id}`,
      title: `Toggle ${sec.label} Section`,
      run: () => {
        void window.airlock.setSectionVisibility(sec.id, !visible);
      },
    });
  }
  return cmds;
}
