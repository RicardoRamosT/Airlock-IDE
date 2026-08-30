import { useEffect, useState } from "react";
import { renderBrief } from "../lib/atlasBrief";
import { AtlasChat } from "./AtlasChat";
import { AtlasConsent } from "./AtlasConsent";

// The ONE Atlas panel. Four surfaces host it -- the titlebar dropdown, the
// standalone window, the sidebar section, and the menu bar popover -- and each
// used to carry its own near-copy of this logic. That is how the standalone
// window ended up with no History, New chat or Debrief buttons at all: the
// header lived in the dropdown's copy and nowhere else.
export interface AtlasPanelProps {
  // When the panel IS the window, it draws its own title row; when it is
  // hosted inside a dropdown or a sidebar section, the host provides one.
  standalone?: boolean;
  onBriefRead?: (day: string) => void;
}

export function AtlasPanel({
  standalone = false,
  onBriefRead,
}: AtlasPanelProps) {
  const [brief, setBrief] = useState<{ day: string; text: string } | null>(
    null,
  );
  const [state, setState] = useState<{
    acknowledged: boolean;
    disclosure: string;
  } | null>(null);
  const [asked, setAsked] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [history, setHistory] = useState<
    { session: number; startedAt: number; turns: number; preview: string }[]
  >([]);

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
    const off = window.airlock?.onAtlasRefresh?.(load);
    return () => {
      alive = false;
      if (typeof off === "function") off();
    };
  }, []);

  if (!asked) return <p className="atlas-note">Loading...</p>;

  if (state !== null && !state.acknowledged) {
    return (
      <AtlasConsent
        disclosure={state.disclosure}
        onAccept={() => {
          window.airlock?.atlasConsent();
          setState({ ...state, acknowledged: true });
        }}
      />
    );
  }

  return (
    <>
      <div className={standalone ? "atlas-titlebar" : "atlas-popover-head"}>
        <span className="atlas-mark" aria-hidden="true">
          &#10022;
        </span>
        <h1>Atlas</h1>
        {showChat ? (
          <>
            <button
              type="button"
              className="atlas-btn"
              title="Past conversations"
              onClick={() => {
                setShowHistory((v) => !v);
                void window.airlock
                  ?.atlasSessions()
                  .then(setHistory)
                  .catch(() => setHistory([]));
              }}
            >
              History
            </button>
            <button
              type="button"
              className="atlas-btn"
              title="Start a fresh conversation. Atlas keeps what it has learned about your projects."
              onClick={() => {
                void window.airlock?.atlasNewChat();
                setShowHistory(false);
                setReloadKey((k) => k + 1);
              }}
            >
              New chat
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="atlas-btn"
          onClick={() => {
            setShowHistory(false);
            setShowChat((v) => {
              if (v && brief) onBriefRead?.(brief.day);
              return !v;
            });
          }}
        >
          {showChat ? "Debrief" : "Chat"}
        </button>
      </div>

      {showChat && showHistory ? (
        <div className="atlas-history">
          {history.length === 0 ? (
            <p className="atlas-note">No past conversations yet.</p>
          ) : (
            history.map((h) => (
              <button
                key={`s${h.session}`}
                type="button"
                className="atlas-history-row"
                onClick={() => {
                  void window.airlock?.atlasResume(h.session);
                  setShowHistory(false);
                  setReloadKey((k) => k + 1);
                }}
              >
                <span className="atlas-history-when">
                  {new Date(h.startedAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="atlas-history-preview">
                  {h.preview || "(no messages)"}
                </span>
                <span className="atlas-history-count">{h.turns}</span>
              </button>
            ))
          )}
        </div>
      ) : showChat ? (
        <div className="atlas-pane-chat">
          <AtlasChat chrome={false} reloadKey={reloadKey} />
        </div>
      ) : brief === null ? (
        <p className="atlas-note">
          No debrief yet. Atlas writes one each morning, once you are back at
          your Mac.
        </p>
      ) : (
        <div className="atlas-brief">{renderBrief(brief.text)}</div>
      )}
    </>
  );
}
