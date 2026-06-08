import { useEffect } from "react";
import { useApp } from "../store";
import { closeEditorFile, openEditorFile } from "./editorFiles";
import { openPickedFolder } from "./openFolder";

// Dispatch File-menu actions (pushed from main as "menu:action") to store + IPC.
// Mirrors the existing onSectionsChanged subscriber: subscribe on mount, return
// the unsubscribe.
export function useMenuActions(): void {
  useEffect(() => {
    return window.airlock.onMenuAction(async (a) => {
      const s = useApp.getState();
      switch (a.type) {
        case "open-folder": {
          const picked = await window.airlock.openFolder();
          if (picked) await openPickedFolder(picked);
          break;
        }
        case "open-recent": {
          const root = await window.airlock.workspaceOpen(a.path);
          if (root) await openPickedFolder(root);
          break;
        }
        case "open-file": {
          const rel = await window.airlock.openFile();
          // Open as an editor tab in the focused tab (openEditorFile reads the
          // focused project's root, then store.openFile).
          if (rel) await openEditorFile(s.activeTabId, rel);
          break;
        }
        case "new-tab": {
          // tabs mode: the File menu / dock "New Tab" opens a blank tab in this
          // (focused) window. Mirrors the tab-strip + button.
          s.openBlankTab();
          break;
        }
        case "close-editor": {
          // Close whatever the content area is showing: an overlay
          // (diff/settings/db) if one is up, otherwise the active editor tab.
          if (s.diff) s.setDiff(null);
          else if (s.settingsOpen) s.setSettingsOpen(false);
          else if (s.dbView) s.setDbView(null);
          else if (s.selectedFile)
            await closeEditorFile(s.activeTabId, s.selectedFile);
          break;
        }
        case "close-folder": {
          await window.airlock.workspaceClose();
          s.setRoot(null);
          break;
        }
        case "quick-open": {
          s.openPalette("files");
          break;
        }
        case "command-palette": {
          s.openPalette("commands");
          break;
        }
        case "find-in-files": {
          s.setSearchOpen(true);
          break;
        }
      }
    });
  }, []);
}
