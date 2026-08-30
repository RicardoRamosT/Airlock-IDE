import { useEffect, useState } from "react";
import { AtlasConsent } from "./AtlasConsent";

// The composer writes light markdown (** for emphasis, "- " and "1." for
// lists). Rendering it raw shows literal asterisks, so this handles just those
// three shapes -- a full markdown engine would be far more than this needs.
function inline(text: string, key: string) {
  // Keyed by the part's OFFSET in the source string, not by array index: the
  // offset is a real identity for that run of text.
  let at = 0;
  return text.split(/(\*\*[^*]+\*\*)/g).map((part) => {
    const k = `${key}@${at}`;
    at += part.length;
    return part.startsWith("**") && part.endsWith("**") ? (
      <strong key={k}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={k}>{part}</span>
    );
  });
}

function renderBrief(text: string) {
  return text.split("\n").map((line, i) => {
    const k = `l${i}`;
    const t = line.trim();
    if (t.length === 0) return <div key={k} className="atlas-brief-gap" />;
    const bullet = /^[-*]\s+/.test(t);
    return (
      <p key={k} className={bullet ? "atlas-brief-item" : "atlas-brief-line"}>
        {inline(bullet ? t.replace(/^[-*]\s+/, "") : t, k)}
      </p>
    );
  });
}

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
    // Main re-sends this every time the popover opens: a debrief composed after
    // the first mount used to stay invisible behind "No debrief yet".
    const off = window.airlock?.onAtlasRefresh(load);
    return () => {
      alive = false;
      off?.();
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
          No debrief yet. Atlas writes one each morning, the first time you are
          back at your Mac.
        </p>
      ) : (
        <div className="atlas-brief">{renderBrief(brief)}</div>
      )}
    </div>
  );
}
