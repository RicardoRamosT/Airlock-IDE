import { useEffect, useState } from "react";
import { AtlasPanel } from "./AtlasPanel";

// The menu bar popover: a bubble whose pointer aims at the tray icon. Hosts
// the shared panel, so the debrief, the chat, History and New chat are all the
// same here as everywhere else.
export function AtlasPopover() {
  // Where the arrow sits inside the bubble. Main sends this on every open
  // because it is NOT a constant: the window's x is clamped to the display, so
  // a wide panel near an edge gets pushed sideways and a fixed CSS inset ends
  // up aiming at empty menu bar instead of the icon. Falls back to the CSS
  // default until the first message arrives.
  const [pointerX, setPointerX] = useState<number | null>(null);

  useEffect(() => {
    const off = window.airlock?.onAtlasPointer?.((x) => setPointerX(x));
    return () => {
      if (typeof off === "function") off();
    };
  }, []);

  return (
    <div className="atlas-bubble">
      <div
        className="atlas-bubble-pointer"
        aria-hidden="true"
        style={pointerX === null ? undefined : { left: `${pointerX}px` }}
      />
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
