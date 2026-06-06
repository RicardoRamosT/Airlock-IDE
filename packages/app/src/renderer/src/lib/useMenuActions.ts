import { useEffect } from "react";
import { useApp } from "../store";
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
          // openFile only resolves a path when a folder is open, so s.root (the
          // focused project's root) is present; pass it so the read resolves the
          // focused project (== the window root, so resolveRoot is identical).
          if (rel && s.root) {
            const file = await window.airlock.readFile(s.root, rel);
            s.setSelected(rel, file);
          }
          break;
        }
        case "new-tab": {
          // tabs mode: the File menu / dock "New Tab" opens a blank tab in this
          // (focused) window. Mirrors the tab-strip + button.
          s.openBlankTab();
          break;
        }
        case "close-editor": {
          // Return the viewer-pane to the full-terminal state, exactly like the
          // Viewer's X button. setSelected(null, null) already clears
          // diff/settings/dbView via the store's mutual-exclusion, but we clear
          // every occupant explicitly so this stays correct regardless of which
          // one is showing.
          s.setDiff(null);
          s.setSettingsOpen(false);
          s.setDbView(null);
          s.setSelected(null, null);
          break;
        }
        case "close-folder": {
          await window.airlock.workspaceClose();
          s.setRoot(null);
          break;
        }
      }
    });
  }, []);
}
