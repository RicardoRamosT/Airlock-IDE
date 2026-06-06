import { useEffect } from "react";
import { useApp } from "../store";

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
          if (picked) s.setRoot(picked);
          break;
        }
        case "open-recent": {
          const root = await window.airlock.workspaceOpen(a.path);
          if (root) s.setRoot(root);
          break;
        }
        case "open-file": {
          const rel = await window.airlock.openFile();
          if (rel) {
            const file = await window.airlock.readFile(rel);
            s.setSelected(rel, file);
          }
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
