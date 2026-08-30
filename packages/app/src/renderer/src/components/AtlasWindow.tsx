import { AtlasPanel } from "./AtlasPanel";

// Atlas as its own window. It hosts the SAME panel as the titlebar dropdown --
// that is the point: this window previously rendered the bare chat and so had
// no History, New chat or Debrief buttons, because those lived only in the
// dropdown's copy of the layout.
export function AtlasWindow() {
  return (
    <div className="atlas-window">
      <AtlasPanel standalone />
    </div>
  );
}
