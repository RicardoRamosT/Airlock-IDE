import { useEffect, useState } from "react";
import { isUnread } from "../lib/atlasUnread";
import { useApp } from "../store";

// Atlas's in-app entry point: the mark at the FAR RIGHT of the titlebar, at
// the head of the portfolio spine's column.
//
// It is a button and nothing else. It used to own a resizable dropdown panel
// holding its own copy of the conversation, which became a second Atlas the
// moment the spine gained one -- clicking the mark opened a floating chat that
// ignored the strip entirely. Now it opens the SPINE's overlay, portfolio-wide
// (root null), and toggles like every dot on the strip.
//
// Lost with the dropdown: that panel was resizable, and `atlas.width/height`
// still exist in prefs for the menu-bar popover. The overlay is a fixed width.
export function AtlasTitlebarButton() {
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
        title="Atlas, your project administrator"
        aria-label="Atlas"
        onClick={() => {
          // Opens the SPINE's overlay, not a second floating panel. Two Atlas
          // surfaces -- a dropdown here and an overlay on the strip -- read as
          // two different Atlases; this mark is the head of the strip, so it
          // opens the strip's conversation, portfolio-wide (root null).
          // Toggles, like every dot on the spine.
          const st = useApp.getState();
          const already = st.atlasOverlay?.root === null;
          st.setAtlasOverlay(already ? null : { root: null });
          if (!already && brief) markReadDay(brief.day);
        }}
      >
        <i className="codicon codicon-sparkle" />
        {unread && <span className="titlebar-atlas-dot" />}
      </button>
    </div>
  );
}
