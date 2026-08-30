import { AtlasPanel } from "./AtlasPanel";

// The menu bar popover: a bubble whose pointer aims at the tray icon. Hosts
// the shared panel, so the debrief, the chat, History and New chat are all the
// same here as everywhere else.
export function AtlasPopover() {
  return (
    <div className="atlas-bubble">
      <div className="atlas-bubble-pointer" aria-hidden="true" />
      <div className="atlas-popover">
        <AtlasPanel />
        <button
          type="button"
          className="atlas-btn"
          onClick={() => window.airlock?.atlasOpenWindow()}
        >
          Open in a window
        </button>
      </div>
    </div>
  );
}
