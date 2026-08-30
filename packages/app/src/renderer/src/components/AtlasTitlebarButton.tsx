import { useEffect, useRef, useState } from "react";
import { renderBrief } from "../lib/atlasBrief";
import { isUnread } from "../lib/atlasUnread";
import { useApp } from "../store";
import { AtlasChat } from "./AtlasChat";
import { AtlasConsent } from "./AtlasConsent";

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
  const [showChat, setShowChat] = useState(false);
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

  // Opening the panel on the debrief is what counts as reading it.
  function markRead() {
    if (brief === null || brief.day <= atlas.lastReadDay) return;
    const next = { ...atlas, lastReadDay: brief.day };
    setAtlas(next);
    void window.airlock?.atlasMarkRead(brief.day);
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
          if (next && !showChat) markRead();
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
          {/* The grip is on the BOTTOM-LEFT, not the bottom-right: the panel is
              anchored to the right edge of the window, so it grows leftward and
              downward. A bottom-right grip would sit at the one corner that
              never moves. CSS `resize` can only ever place it bottom-right, so
              this is a pointer-driven handle. */}
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
                // Dragging LEFT widens; dragging DOWN heightens.
                const width = Math.min(
                  900,
                  Math.max(280, Math.round(startW - (ev.clientX - startX))),
                );
                const height = Math.min(
                  1200,
                  Math.max(240, Math.round(startH + (ev.clientY - startY))),
                );
                setAtlas({ ...atlas, width, height });
              };
              const up = () => {
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerup", up);
                // Persist once, on release, rather than on every pixel.
                void window.airlock?.prefsSet({
                  atlas: useApp.getState().atlas,
                });
              };
              el.addEventListener("pointermove", move);
              el.addEventListener("pointerup", up);
            }}
          />
          {!asked ? (
            <p className="atlas-note">Loading...</p>
          ) : state !== null && !state.acknowledged ? (
            <AtlasConsent
              disclosure={state.disclosure}
              onAccept={() => {
                window.airlock?.atlasConsent();
                setState({ ...state, acknowledged: true });
              }}
            />
          ) : (
            <>
              <div className="atlas-popover-head">
                <span className="atlas-mark" aria-hidden="true">
                  &#10022;
                </span>
                <h1>Atlas</h1>
                <button
                  type="button"
                  className="atlas-btn"
                  onClick={() =>
                    setShowChat((v) => {
                      if (v) markRead(); // returning to the debrief reads it
                      return !v;
                    })
                  }
                >
                  {showChat ? "Debrief" : "Chat"}
                </button>
              </div>
              {showChat ? (
                <div className="atlas-pane-chat">
                  <AtlasChat chrome={false} />
                </div>
              ) : brief === null ? (
                <p className="atlas-note">
                  No debrief yet. Atlas writes one each morning, once you are
                  back at your Mac.
                </p>
              ) : (
                <div className="atlas-brief">{renderBrief(brief.text)}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
