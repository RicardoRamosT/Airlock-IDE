import { useEffect, useRef, useState } from "react";
import type { AtlasConcern, AtlasProject } from "../../../shared/ipc";
import { renderBrief } from "../lib/atlasBrief";
import { AtlasChat } from "./AtlasChat";
import { AtlasConsent } from "./AtlasConsent";
import { AtlasSettings } from "./AtlasSettings";

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
    hour: number;
    surface: "app" | "both";
  } | null>(null);
  const [asked, setAsked] = useState(false);
  // Seeded from the persisted view, not defaulted to the debrief: the panel is
  // hosted by four surfaces across three windows, so component state meant
  // closing a mid-conversation panel and reopening it landed back on the
  // debrief with the chat apparently gone.
  // Three views, not two. Settings is transient and deliberately NOT
  // persisted through atlasSetView: reopening the panel should land you back
  // on your work, not on the screen where you last changed a setting.
  const [view, setView] = useState<"brief" | "chat" | "settings">("brief");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // null = NOT ASKED YET, distinct from [] = asked and the portfolio is empty.
  // The setup state turns on this difference, so conflating them would flash
  // "Atlas does not know what to watch" at every open.
  const [projects, setProjects] = useState<AtlasProject[] | null>(null);
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

  // A menu that only closes via its own items is a trap in a 412px popover.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      Promise.all([
        window.airlock?.atlasState() ?? null,
        window.airlock?.atlasBrief() ?? null,
        window.airlock?.atlasConcerns?.() ?? [],
        window.airlock?.atlasProjects?.() ?? [],
      ])
        .then(([s, text, open, projs]) => {
          if (alive) setConcerns(open ?? []);
          if (alive) setProjects(projs ?? []);
          if (!alive) return;
          setState(s);
          setBrief(text);
          // Only on the FIRST load, tracked by a REF: `load` is also the
          // refresh handler and closes over its initial state, so testing a
          // piece of state here would re-seed on every refresh and yank the
          // user out of the view they had since switched to.
          if (!seeded.current && s) {
            seeded.current = true;
            setView(s.lastView === "chat" ? "chat" : "brief");
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

  // Switching to the debrief marks it read, and only brief/chat persist --
  // settings is transient (see the view state above).
  const go = (next: "brief" | "chat") => {
    setMenuOpen(false);
    if (next === "brief" && view === "chat" && brief) onBriefRead?.(brief.day);
    setView(next);
    void window.airlock?.atlasSetView?.(next);
  };

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
        <div className="atlas-tabs" role="tablist" aria-label="Atlas view">
          <button
            type="button"
            role="tab"
            aria-selected={view === "brief"}
            onClick={() => go("brief")}
          >
            Debrief
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "chat"}
            onClick={() => go("chat")}
          >
            Chat
          </button>
        </div>
        <button
          type="button"
          className="atlas-btn atlas-more"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="More"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          &#8943;
        </button>
        {menuOpen ? (
          <div className="atlas-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                go("chat");
                setShowHistory(true);
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
              role="menuitem"
              onClick={() => {
                // AWAIT the write: refetching first would read the OLD
                // conversation boundary and show the same transcript back.
                void (async () => {
                  setMenuOpen(false);
                  await window.airlock?.atlasNewChat();
                  setShowHistory(false);
                  go("chat");
                  setReloadKey((k) => k + 1);
                })();
              }}
            >
              New chat
            </button>
            <hr />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void window.airlock?.atlasOpenWindow?.();
              }}
            >
              Open in a window
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setShowHistory(false);
                setView("settings");
              }}
            >
              Atlas settings
            </button>
          </div>
        ) : null}
      </div>

      {view === "settings" ? (
        <AtlasSettings
          hour={state?.hour ?? 8}
          surface={state?.surface ?? "both"}
          projects={projects}
          onPrefs={(patch) => {
            setState((s) => (s ? { ...s, ...patch } : s));
            void window.airlock?.atlasSetPrefs?.(patch);
          }}
          onToggle={(root, enabled) => {
            // Optimistic, then the atlas:refresh broadcast reloads from the
            // table and becomes the truth.
            setProjects((ps) =>
              ps
                ? ps.map((p) => (p.root === root ? { ...p, enabled } : p))
                : ps,
            );
            void window.airlock?.atlasSetProjectEnabled?.(root, enabled);
          }}
        />
      ) : view === "chat" && showHistory ? (
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
      ) : view === "chat" ? (
        <div className="atlas-pane-chat">
          <AtlasChat chrome={false} reloadKey={reloadKey} ask={ask} />
        </div>
      ) : loadFailed ? (
        <p className="atlas-note">
          Could not load the debrief. Nothing has been lost -- try reopening.
        </p>
      ) : (
        <>
          {/* TWO INDEPENDENT READS, TWO INDEPENDENT BRANCHES. Concerns are
              fetched live -- deliberately, so one that has since resolved
              stops being shown -- and were then rendered INSIDE the
              brief !== null branch, which threw that independence away: every
              morning until the brief was composed, and all day if a compose
              failed, the whole standing-concerns list was invisible and the
              forget action with it. A missing debrief is not evidence that
              nothing is open. */}
          {/* FOUR states here, not three. "Atlas has nothing to watch" and
              "Atlas is watching and nothing happened yet" look identical from
              the outside, and opt-in makes the first one the DEFAULT on
              upgrade -- so without this note a correctly-working Atlas is
              indistinguishable from a broken one. projects === null is NOT
              ASKED YET and must show nothing rather than the setup prompt.
              Rendered ABOVE any existing brief too: yesterday's debrief is
              real, but nothing is going to produce tomorrow's.

              length > 0 matters: an EMPTY portfolio is a different state from
              a portfolio with nothing switched on. The first fixes itself the
              moment you open a project; only the second is a dead end that
              needs telling. */}
          {projects !== null &&
          projects.length > 0 &&
          projects.every((p) => !p.enabled) ? (
            <div className="atlas-setup">
              <p>
                Atlas does not know which projects to watch yet, so it will not
                write a debrief.
              </p>
              <button
                type="button"
                className="atlas-btn primary"
                onClick={() => {
                  setShowHistory(false);
                  setView("settings");
                }}
              >
                Choose projects
              </button>
            </div>
          ) : null}
          {brief === null ? (
            projects !== null &&
            projects.length > 0 &&
            projects.every((p) => !p.enabled) ? null : (
              <p className="atlas-note">
                No debrief yet. Atlas writes one each morning, once you are back
                at your Mac.
              </p>
            )
          ) : (
            <div className="atlas-brief">{renderBrief(brief.text)}</div>
          )}
          {concerns !== null && concerns.length > 0 ? (
            <div className="atlas-standing">
              <p className="atlas-standing-head">Still open</p>
              {concerns.map((c) => {
                // Read ONCE, into a local: TypeScript's narrowing of a
                // PROPERTY does not survive into the click handler's closure.
                const gone = c.missingRoot;
                return (
                  <div key={c.key} className="atlas-standing-row">
                    <span className="atlas-standing-what">
                      {c.project ? <strong>{c.project}</strong> : null}{" "}
                      {c.title}
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
                    {gone !== null ? (
                      // A vanished folder is the one concern that cannot be
                      // fixed, only forgotten -- and it REPLACES "Look into
                      // this", because there is nothing on disk left to look
                      // into and the registry never evicts on its own, so
                      // without this the row is re-raised on every refresh
                      // forever.
                      <button
                        type="button"
                        className="atlas-btn"
                        title="Drop it from Atlas's portfolio and from Open Recent. Nothing on disk is touched."
                        onClick={() => {
                          // No optimistic removal: main broadcasts atlas:refresh
                          // once the three writes land, and every surface --
                          // including this one -- reloads from the table.
                          void window.airlock?.atlasForget?.(gone);
                        }}
                      >
                        Forget this project
                      </button>
                    ) : (
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
                          setView("chat");
                          void window.airlock?.atlasSetView?.("chat");
                        }}
                      >
                        Look into this
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
