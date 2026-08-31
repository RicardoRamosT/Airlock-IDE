import { useEffect, useRef, useState } from "react";
import type { AtlasConcern } from "../../../shared/ipc";
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
    lastView: "brief" | "chat";
  } | null>(null);
  const [asked, setAsked] = useState(false);
  // Seeded from the persisted view, not defaulted to the debrief: the panel is
  // hosted by four surfaces across three windows, so component state meant
  // closing a mid-conversation panel and reopening it landed back on the
  // debrief with the chat apparently gone.
  const [showChat, setShowChat] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Fourth state: "asked and there is none" is not "asked and it failed".
  // Saying "No debrief yet" when the read failed is a confident wrong answer.
  const [loadFailed, setLoadFailed] = useState(false);
  // Read LIVE rather than from the debrief text: a concern that has since
  // resolved must stop being shown, including while an older brief is on
  // screen. null = not asked yet, [] = asked and none.
  const [concerns, setConcerns] = useState<AtlasConcern[] | null>(null);
  // The concern handed to the chat, and a nonce so asking about the SAME one
  // twice still sends twice.
  const [ask, setAsk] = useState<{ text: string; n: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [history, setHistory] = useState<
    { session: number; startedAt: number; turns: number; preview: string }[]
  >([]);

  const seeded = useRef(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      Promise.all([
        window.airlock?.atlasState() ?? null,
        window.airlock?.atlasBrief() ?? null,
        window.airlock?.atlasConcerns?.() ?? [],
      ])
        .then(([s, text, open]) => {
          if (alive) setConcerns(open ?? []);
          if (!alive) return;
          setState(s);
          setBrief(text);
          // Only on the FIRST load, tracked by a REF: `load` is also the
          // refresh handler and closes over its initial state, so testing a
          // piece of state here would re-seed on every refresh and yank the
          // user out of the view they had since switched to.
          if (!seeded.current && s) {
            seeded.current = true;
            setShowChat(s.lastView === "chat");
          }
          setLoadFailed(false);
          setAsked(true);
        })
        .catch(() => {
          if (!alive) return;
          setLoadFailed(true);
          setAsked(true);
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
                // AWAIT the write: refetching first would read the OLD
                // conversation boundary and show the same transcript back.
                void (async () => {
                  await window.airlock?.atlasNewChat();
                  setShowHistory(false);
                  setReloadKey((k) => k + 1);
                })();
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
              void window.airlock?.atlasSetView?.(v ? "brief" : "chat");
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
                  void (async () => {
                    await window.airlock?.atlasResume(h.session);
                    setShowHistory(false);
                    setReloadKey((k) => k + 1);
                  })();
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
          <AtlasChat chrome={false} reloadKey={reloadKey} ask={ask} />
        </div>
      ) : loadFailed ? (
        <p className="atlas-note">
          Could not load the debrief. Nothing has been lost -- try reopening.
        </p>
      ) : brief === null ? (
        <p className="atlas-note">
          No debrief yet. Atlas writes one each morning, once you are back at
          your Mac.
        </p>
      ) : (
        <>
          <div className="atlas-brief">{renderBrief(brief.text)}</div>
          {concerns !== null && concerns.length > 0 ? (
            <div className="atlas-standing">
              <p className="atlas-standing-head">Still open</p>
              {concerns.map((c) => (
                <div key={c.key} className="atlas-standing-row">
                  <span className="atlas-standing-what">
                    {c.project ? <strong>{c.project}</strong> : null} {c.title}
                  </span>
                  <span className="atlas-standing-age">
                    {c.ageDays === 0
                      ? "today"
                      : c.ageDays === 1
                        ? "1 day"
                        : `${c.ageDays} days`}
                    {c.trend
                      ? ` \u00b7 ${c.trend.from} \u2192 ${c.trend.to}`
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="atlas-btn"
                    onClick={() => {
                      // The whole point of tier 2: a concern is an entry point,
                      // not prose. Carry enough that Atlas knows which one.
                      setAsk((prev) => ({
                        n: (prev?.n ?? 0) + 1,
                        text: `Look into this standing concern: ${
                          c.project ? `${c.project} - ` : ""
                        }${c.title}. ${c.detail} It has been open ${c.ageDays} day(s)${
                          c.trend
                            ? `, and has gone from ${c.trend.from} to ${c.trend.to}`
                            : ""
                        }. Investigate it properly and tell me what to do.`,
                      }));
                      setShowChat(true);
                      void window.airlock?.atlasSetView?.("chat");
                    }}
                  >
                    Look into this
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
