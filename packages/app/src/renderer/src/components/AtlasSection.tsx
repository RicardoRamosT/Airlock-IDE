import { useEffect, useState } from "react";
import { renderBrief } from "../lib/atlasBrief";
import { AtlasChat } from "./AtlasChat";
import { AtlasConsent } from "./AtlasConsent";

// Atlas as a sidebar section -- the DEFAULT surface. A page tab would replace
// the workspace and hide the code the debrief is about; a section sits beside
// it, which is the whole point of being able to work and talk at once.
export function AtlasSection() {
  const [brief, setBrief] = useState<string | null>(null);
  const [state, setState] = useState<{
    acknowledged: boolean;
    disclosure: string;
  } | null>(null);
  const [asked, setAsked] = useState(false);
  const [showChat, setShowChat] = useState(false);

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

  if (!asked) return <div className="atlas-pane">Loading...</div>;

  if (state !== null && !state.acknowledged) {
    return (
      <div className="atlas-pane">
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
    <div className="atlas-pane">
      <div className="section-toolbar">
        <button
          type="button"
          className={`btn${showChat ? "" : " primary"}`}
          onClick={() => setShowChat(false)}
        >
          Debrief
        </button>
        <button
          type="button"
          className={`btn${showChat ? " primary" : ""}`}
          onClick={() => setShowChat(true)}
        >
          Chat
        </button>
      </div>
      {showChat ? (
        <div className="atlas-pane-chat">
          <AtlasChat chrome={false} />
        </div>
      ) : brief === null ? (
        <p className="section-empty-note">
          No debrief yet. Atlas writes one each morning, once you are back at
          your Mac.
        </p>
      ) : (
        <div className="atlas-brief atlas-brief-pane">{renderBrief(brief)}</div>
      )}
    </div>
  );
}
