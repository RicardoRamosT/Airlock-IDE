import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { AtlasConcern, AtlasProject } from "../../../shared/ipc";
import { renderBrief } from "../lib/atlasBrief";
import {
  ATLAS_STANDING_DEFAULT,
  ATLAS_STANDING_FADE_AT,
  ATLAS_STANDING_MAX,
  ATLAS_STANDING_MIN,
  availableFor,
  resizeStanding,
  type StandingBounds,
} from "../lib/atlasStandingResize";
import { AtlasChat } from "./AtlasChat";
import { AtlasConsent } from "./AtlasConsent";
import { AtlasSettings } from "./AtlasSettings";

// The ONE Atlas panel. Four surfaces host it -- the titlebar dropdown, the
// standalone window, the sidebar section, and the menu bar popover -- and each
// used to carry its own near-copy of this logic. That is how the standalone
// window ended up with no History, New chat or Debrief buttons at all: the
// header lived in the dropdown's copy and nowhere else.
const KEY_STEP = 16; // px the divider moves per Arrow keypress

// The thin DOM layer the pure resizer cannot have: read the three bounds off
// the live list. Anything it cannot measure comes back 0, which resizeStanding
// reads as "unbounded" rather than as a ceiling of zero.
function measureStanding(list: HTMLElement): StandingBounds {
  const row = list.querySelector<HTMLElement>(".atlas-standing-row");
  // Which element bounds the list differs per surface, so measure the host
  // rather than hard-coding one layout.
  const panel = list.closest<HTMLElement>(
    ".titlebar-atlas-panel, .atlas-popover, .atlas-window",
  );
  const section = list.closest<HTMLElement>(".atlas-standing");
  // What the section spends above the list: the divider and the STILL OPEN
  // header. Subtracted so the ceiling is room for the LIST, not for the
  // section -- otherwise the header quietly eats into the debrief's floor.
  const chrome =
    section === null
      ? 0
      : list.getBoundingClientRect().top - section.getBoundingClientRect().top;
  return {
    rowHeight: row?.getBoundingClientRect().height ?? 0,
    contentHeight: list.scrollHeight,
    available: panel === null ? 0 : availableFor(panel.clientHeight, chrome),
  };
}

export interface AtlasPanelProps {
  // When the panel IS the window, it draws its own title row; when it is
  // hosted inside a dropdown or a sidebar section, the host provides one.
  standalone?: boolean;
  onBriefRead?: (day: string) => void;
  // The project this panel was opened FROM (the spine's dot), or null for the
  // portfolio-wide chat. Passed to the send so Atlas answers about it.
  focusRoot?: string | null;
}

export function AtlasPanel({
  standalone = false,
  onBriefRead,
  focusRoot = null,
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
  // Collapsed state for the standing concerns. Local, not a pref: the bounded
  // height below is what actually stops the section burying the debrief, so
  // this is convenience and does not warrant a pref, a sanitizer and an IPC.
  const [standingShut, setStandingShut] = useState(false);
  // Height of the standing-concerns list, in px, set by dragging the divider
  // above it. Unlike the collapse above this IS persisted -- a size you set
  // with a deliberate drag should survive reopening the panel -- and it comes
  // over IPC rather than from the app store, which the popover and the
  // standalone window never hydrate.
  const [standingH, setStandingH] = useState(ATLAS_STANDING_DEFAULT);
  const standingRef = useRef<HTMLDivElement | null>(null);
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
          // Re-seeded on every refresh, not once: another window may have
          // dragged it, and the drag persists on release so there is no
          // in-progress value here for a refresh to stomp on.
          if (typeof s?.standingHeight === "number") {
            setStandingH(s.standingHeight);
          }
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

  // Commit a height: to component state (which re-renders the inline style) and
  // to prefs. main does the read-modify-write, because writing the whole atlas
  // object from here would take lastView and lastReadDay with it.
  const commitStanding = (next: number) => {
    setStandingH(next);
    void window.airlock?.atlasSetPrefs?.({ standingHeight: next });
  };

  // Dragging mutates the element directly and commits on release, so the panel
  // does not re-render (and re-parse the whole debrief) once per mousemove.
  const onGripDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const list = standingRef.current;
    if (!list) return;
    const startY = e.clientY;
    const startH = list.getBoundingClientRect().height || standingH;
    // Measured ONCE at drag start: measuring per move would read the height
    // the drag itself just set and the bounds would chase the pointer.
    const bounds = measureStanding(list);
    document.body.classList.add("resizing-row");
    let next = startH;
    const onMove = (ev: MouseEvent) => {
      next = resizeStanding(startH, ev.clientY - startY, bounds);
      list.style.height = `${next}px`;
      list.classList.toggle("is-tight", next < ATLAS_STANDING_FADE_AT);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing-row");
      commitStanding(next);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Arrow Up/Down nudge the divider in the same physical sense as a drag. A
  // splitter reachable only by mouse is not reachable.
  const onGripKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const list = standingRef.current;
    if (!list) return;
    commitStanding(
      resizeStanding(standingH, dir * KEY_STEP, measureStanding(list)),
    );
  };

  // The header's scope label. A basename, not the path: the strip already
  // names projects that way and the row has one line to spend.
  const headTitle =
    focusRoot === null
      ? "Atlas"
      : (focusRoot.split("/").filter(Boolean).pop() ?? "Atlas");

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
        {/* WHOSE conversation this is. Opened from a spine dot the header
            names the PROJECT: a row reading "ATLAS" above answers scoped to
            one project tells you nothing about which one, and the scope is
            the only thing about this header you cannot infer from the tabs.
            The decorative mark that used to sit here is gone -- it competed
            with the scope for the one piece of the row that carries meaning. */}
        <h1 className="atlas-head-title" title={focusRoot ?? undefined}>
          {headTitle}
        </h1>
        {/* Tabs and the overflow menu are ONE group pinned right, so the row
            reads as scope-on-the-left, controls-on-the-right rather than
            three things spaced apart by whatever flex happened to do. */}
        <div className="atlas-head-actions">
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
        </div>
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
          <AtlasChat
            chrome={false}
            reloadKey={reloadKey}
            ask={ask}
            focusRoot={focusRoot}
          />
        </div>
      ) : loadFailed ? (
        <p className="atlas-note">
          Could not load the debrief. Nothing has been lost. Try reopening.
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
              {/* The rule above the section IS the resize handle. It is drawn
                  either way so the section never loses its top border, but it
                  only becomes a separator when there is a list to resize -- a
                  handle that does nothing is worse than no handle. */}
              {standingShut ? (
                <div className="atlas-standing-grip" aria-hidden="true" />
              ) : (
                // biome-ignore lint/a11y/useSemanticElements: a splitter is a focusable, interactive ARIA "separator"; <hr> cannot carry the drag/keyboard handlers this needs.
                <div
                  className="atlas-standing-grip"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize Still open"
                  aria-valuenow={standingH}
                  aria-valuemin={ATLAS_STANDING_MIN}
                  aria-valuemax={ATLAS_STANDING_MAX}
                  tabIndex={0}
                  title="Drag to resize; double-click to reset"
                  onMouseDown={onGripDown}
                  onKeyDown={onGripKey}
                  onDoubleClick={() => commitStanding(ATLAS_STANDING_DEFAULT)}
                />
              )}
              {/* Collapsible, and BOUNDED when open. Eight concerns at three
                  lines each is taller than the whole panel, so the section
                  used to push the debrief off the top -- the one thing the
                  panel exists to show. */}
              <button
                type="button"
                className="atlas-standing-head"
                aria-expanded={!standingShut}
                onClick={() => setStandingShut((v) => !v)}
              >
                <span className="atlas-chevron" aria-hidden="true">
                  {standingShut ? "\u203a" : "\u2039"}
                </span>
                Still open
                <span className="sb-badge">{concerns.length}</span>
              </button>
              {/* Conditionally RENDERED, not `hidden`. The hidden attribute
                  removes an element from the accessibility tree but loses to
                  any author display rule -- the UA sheet's
                  [hidden]{display:none} is user-agent origin, so this list
                  kept its display:flex and stayed fully visible while being
                  invisible to a screen reader. Every other branch in this file
                  renders conditionally; this one now matches. */}
              {standingShut ? null : (
                <div
                  className={`atlas-standing-list${
                    standingH < ATLAS_STANDING_FADE_AT ? " is-tight" : ""
                  }`}
                  ref={standingRef}
                  style={{ height: standingH }}
                >
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
                            className="row-action reveal"
                            aria-label="Forget this project"
                            title="Forget this project. Drops it from Atlas's portfolio and from Open Recent; nothing on disk is touched."
                            onClick={() => {
                              // No optimistic removal: main broadcasts atlas:refresh
                              // once the three writes land, and every surface --
                              // including this one -- reloads from the table.
                              void window.airlock?.atlasForget?.(gone);
                            }}
                          >
                            <span aria-hidden="true">{"\u2715"}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="row-action reveal"
                            aria-label="Look into this"
                            title="Look into this"
                            onClick={() => {
                              // The whole point of tier 2: a concern is an entry point,
                              // not prose. Carry enough that Atlas knows which one.
                              setAsk((prev) => ({
                                n: (prev?.n ?? 0) + 1,
                                text: `Look into this standing concern: ${
                                  c.project ? `${c.project}: ` : ""
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
                            <span aria-hidden="true">{"\u2192"}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
