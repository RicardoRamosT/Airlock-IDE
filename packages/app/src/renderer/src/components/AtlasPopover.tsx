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
  if (!asked) return <div className="atlas-popover">Loading...</div>;

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
      <h1>Atlas</h1>
      <button type="button" onClick={() => window.airlock?.atlasOpenWindow()}>
        Open Atlas
      </button>
      {brief === null ? (
        <p>No debrief yet. It writes itself the first time you arrive.</p>
      ) : (
        <pre>{brief}</pre>
      )}
    </div>
  );
}
