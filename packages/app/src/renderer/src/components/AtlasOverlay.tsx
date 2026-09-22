import { useEffect } from "react";
import { AtlasPanel } from "./AtlasPanel";

// The Atlas conversation, hinged on the spine.
//
// It OVERLAYS: absolutely positioned inside the workspace row, so no pane
// resizes and no terminal reflows when it opens. That is not a preference --
// a surface that reflows the editor under you is a surface you learn not to
// open, and the spine exists to be opened casually.
//
// AtlasPanel is reused WHOLE. It is already surface-independent (AtlasWindow
// is literally <AtlasPanel standalone />), so the Debrief/Chat tabs, History
// and the composer all come along, and there is no second chat implementation
// to drift from the first.
export function AtlasOverlay({
  root,
  onClose,
}: {
  root: string;
  onClose: () => void;
}) {
  // Escape closes. Registered only while the overlay is open, so nothing
  // global is captured the rest of the time -- the agent-request cards learned
  // the same lesson about not seizing Escape from the whole window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="atlas-overlay" data-root={root}>
      <AtlasPanel standalone />
    </div>
  );
}
