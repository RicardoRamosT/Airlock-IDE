import { useEffect, useRef, useState } from "react";
import { renderBrief } from "../lib/atlasBrief";
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
  const [brief, setBrief] = useState<string | null>(null);
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

  // A dot, not a number: there is at most one unread debrief a day, so a count
  // would always read "1" and mean nothing.
  const unread = asked && brief !== null && state?.acknowledged === true;

  return (
    <div className="titlebar-atlas">
      <button
        type="button"
        className="titlebar-bell-btn"
        title="Atlas - your project administrator"
        aria-label="Atlas"
        onClick={() => setOpen((v) => !v)}
      >
        <i className="codicon codicon-sparkle" />
        {unread && <span className="titlebar-atlas-dot" />}
      </button>
      {open && (
        <div
          className="titlebar-atlas-panel"
          ref={panelRef}
          style={{ width: atlas.width, height: atlas.height }}
          // CSS `resize` gives a native grip; there is no resize EVENT for an
          // element, so the size is captured when the pointer is released.
          onPointerUp={() => {
            const el = panelRef.current;
            if (!el) return;
            const width = Math.round(el.getBoundingClientRect().width);
            const height = Math.round(el.getBoundingClientRect().height);
            if (width === atlas.width && height === atlas.height) return;
            const next = { ...atlas, width, height };
            setAtlas(next);
            void window.airlock?.prefsSet({ atlas: next });
          }}
        >
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
                  onClick={() => setShowChat((v) => !v)}
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
                <div className="atlas-brief">{renderBrief(brief)}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
