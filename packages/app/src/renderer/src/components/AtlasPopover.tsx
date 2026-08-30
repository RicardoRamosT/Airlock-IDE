import { useEffect, useState } from "react";
import { AtlasConsent } from "./AtlasConsent";

interface AtlasState {
  acknowledged: boolean;
  disclosure: string;
}

// The popover shows today's debrief -- or, until it has been accepted, the
// first-run cost disclosure. Atlas spends nothing before that click, because
// the same call that costs the author quota costs an API-key user real money.
export function AtlasPopover() {
  const [brief, setBrief] = useState<string | null>(null);
  const [state, setState] = useState<AtlasState | null>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let alive = true;
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
    return () => {
      alive = false;
    };
  }, []);

  // Three states, not two: not-asked-yet is loading, asked-and-null is
  // genuinely no brief. Conflating them paints a finished-looking empty page
  // while a fetch is still running. Both fetches gate the first paint, so the
  // consent card never flashes over an install that already accepted it.
  if (!asked)
    return (
      <div className="atlas-popover">
        <p className="atlas-note">Loading...</p>
      </div>
    );

  if (state !== null && !state.acknowledged) {
    return (
      <div className="atlas-popover">
        <AtlasConsent
          disclosure={state.disclosure}
          onAccept={() => {
            window.airlock?.atlasConsent();
            setState({ ...state, acknowledged: true });
          }}
        />
      </div>
    );
  }

  return (
    <div className="atlas-popover">
      <div className="atlas-popover-head">
        <span className="atlas-mark" aria-hidden="true">
          &#10022;
        </span>
        <h1>Atlas</h1>
        <button
          type="button"
          className="atlas-btn"
          onClick={() => window.airlock?.atlasOpenWindow()}
        >
          Open
        </button>
      </div>
      {brief === null ? (
        <p className="atlas-note">
          No debrief yet. Atlas writes one the first time you open AirLock on a
          new day.
        </p>
      ) : (
        <p className="atlas-brief">{brief}</p>
      )}
    </div>
  );
}
