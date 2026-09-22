import { useState } from "react";
import { useSpineDots } from "../lib/useSpineDots";
import { useApp } from "../store";

// The portfolio spine: one dot per open project, on the window's right edge.
//
// At rest it is COLOUR ONLY -- no text, no counts, no badges. 28px you read
// peripherally and otherwise ignore. The moment it carries a number it stops
// being peripheral.
//
// Three rules this file must not break:
//  - THE STRIP NEVER CHANGES WIDTH, and a dot never moves. Hovering shows a
//    callout beside the dot; if it widened the strip or shifted the dot,
//    pointing at something would mean aiming twice -- the lesson the Update
//    stub taught the same week.
//  - The callout is pointer-events:none. It sits directly beside the dot, so
//    one that accepted the pointer would steal the hover from the button,
//    close itself, and flicker.
//  - The callout lives INSIDE its dot's slot, not as a sibling of the strip
//    positioned by index. Alignment is then the browser's problem rather than
//    arithmetic over paddings and gaps that silently rots the moment either
//    changes.
export function AtlasSpine({
  openRoot,
  onOpen,
}: {
  openRoot: string | null;
  onOpen: (root: string) => void;
}) {
  const dots = useSpineDots();
  const atlasEnabled = useApp((st) => st.atlas.enabled);
  const [active, setActive] = useState<string | null>(null);

  // RESERVE THE COLUMN AS SOON AS ATLAS IS ON, even with no dots yet.
  //
  // This used to return null until the first dots arrived, which meant the
  // workspace's fourth column collapsed at first paint and then appeared a
  // moment later -- narrowing the terminal pane by 28px AFTER the terminal had
  // already fitted. The refit fires correctly, but it sends SIGWINCH to a
  // running TUI mid-render, and Claude Code redraws its whole transcript at the
  // new width over the old: the garbled, overlapping output reported here.
  //
  // Keying on the PREF rather than on the data is what fixes it: prefs hydrate
  // before project terminals exist (the same ordering claudeAutoStart relies
  // on), so the width is settled before there is a terminal to disturb.
  if (!atlasEnabled) return null;

  return (
    <div className="atlas-spine">
      {dots.map((d) => (
        <div key={d.root} className="atlas-spine-slot">
          <button
            type="button"
            className="atlas-spine-dot-btn"
            // The only text this surface has. Colour alone is not an
            // accessible status, so the name and the line ride the label.
            aria-label={`${d.name}: ${d.line}`}
            onMouseEnter={() => setActive(d.root)}
            onMouseLeave={() => setActive((r) => (r === d.root ? null : r))}
            onFocus={() => setActive(d.root)}
            onBlur={() => setActive((r) => (r === d.root ? null : r))}
            onClick={() => onOpen(d.root)}
          >
            <span
              className={`atlas-spine-dot tone-${d.tone}${
                d.root === openRoot ? " open" : ""
              }`}
            />
          </button>
          {active === d.root && (
            <div className="atlas-spine-callout" aria-hidden="true">
              <div className="atlas-spine-callout-body">
                <div className="atlas-spine-callout-name">{d.name}</div>
                <div className="atlas-spine-callout-line">{d.line}</div>
              </div>
              <div className="atlas-spine-leader" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
