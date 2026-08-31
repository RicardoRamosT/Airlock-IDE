import { useEffect, useRef, useState } from "react";
import { isUnread } from "../lib/atlasUnread";
import { useApp } from "../store";
import { AtlasPanel } from "./AtlasPanel";

// Atlas's in-app entry point, mounted at the RIGHT END of the titlebar beside
// the notification bell and using the same button + dropdown-panel pattern.
//
// It lives here rather than only in the activity-bar rail because the rail
// holds fourteen icons and an eighth sparkle in that column is genuinely easy
// to miss -- which is exactly what happened. The titlebar is visible whatever
// section is open.
export function AtlasTitlebarButton() {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<{ day: string; text: string } | null>(
    null,
  );
  const [state, setState] = useState<{
    acknowledged: boolean;
    disclosure: string;
  } | null>(null);
  const [asked, setAsked] = useState(false);
  const atlas = useApp((st) => st.atlas);
  const setAtlas = useApp((st) => st.setAtlas);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      Promise.all([
        window.airlock?.atlasState() ?? null,
        window.airlock?.atlasBrief() ?? null,
      ])
        .then(([s, text]) => {
          if (!alive) return;
          setState(s);
          setBrief(text);
          setAsked(true);
        })
        .catch(() => {
          if (alive) setAsked(true);
        });
    };
    load();
    // Defensive on both ends: the API may be absent (older preload, a test
    // stub) and its return value may not be callable. A throw in an effect
    // inside the App tree whites out the whole window.
    const off = window.airlock?.onAtlasRefresh?.(load);
    return () => {
      alive = false;
      if (typeof off === "function") off();
    };
  }, []);

  // "Unread" is the brief's day being NEWER than the last day the user read.
  // The old test was `brief !== null`, which is just "a brief exists" -- it
  // could never turn off, so the dot was permanently lit.
  const unread =
    asked && isUnread(brief, state?.acknowledged === true, atlas.lastReadDay);

  // Reading the debrief is what clears the dot.
  function markReadDay(day: string) {
    if (day <= atlas.lastReadDay) return;
    const next = { ...atlas, lastReadDay: day };
    setAtlas(next);
    void window.airlock?.atlasMarkRead(day);
  }

  return (
    <div className="titlebar-atlas">
      <button
        type="button"
        className="titlebar-bell-btn"
        title="Atlas - your project administrator"
        aria-label="Atlas"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && brief) markReadDay(brief.day);
        }}
      >
        <i className="codicon codicon-sparkle" />
        {unread && <span className="titlebar-atlas-dot" />}
      </button>
      {open && (
        <div
          className="titlebar-atlas-panel"
          ref={panelRef}
          style={{ width: atlas.width, height: atlas.height }}
        >
          {/* Grip bottom-LEFT: the panel is anchored to the right edge, so it
              grows leftward and downward. */}
          <button
            type="button"
            className="atlas-resize-grip"
            aria-label="Resize Atlas panel"
            onPointerDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startY = e.clientY;
              const startW = atlas.width;
              const startH = atlas.height;
              const el = e.currentTarget;
              el.setPointerCapture(e.pointerId);
              const move = (ev: PointerEvent) => {
                setAtlas({
                  ...atlas,
                  width: Math.min(
                    900,
                    Math.max(280, Math.round(startW - (ev.clientX - startX))),
                  ),
                  height: Math.min(
                    1200,
                    Math.max(240, Math.round(startH + (ev.clientY - startY))),
                  ),
                });
              };
              const up = () => {
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerup", up);
                void window.airlock?.prefsSet({
                  atlas: useApp.getState().atlas,
                });
              };
              el.addEventListener("pointermove", move);
              el.addEventListener("pointerup", up);
            }}
          />
          <AtlasPanel onBriefRead={markReadDay} />
        </div>
      )}
    </div>
  );
}
