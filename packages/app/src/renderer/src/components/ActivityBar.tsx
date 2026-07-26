import { Fragment, useEffect, useRef, useState } from "react";
import type { DotLevel, Section, SectionStatuses } from "../../../shared/ipc";
import {
  effectiveView,
  BUILTIN_SECTION_META as SECTION_META,
} from "../lib/sections";
import { useGithubAccountDot } from "../lib/useGithubAccountDot";
import { useSectionStatuses } from "../lib/useSectionStatuses";
import { useApp } from "../store";
import { AccountsPopover } from "./AccountsPopover";
import { SettingsMenu } from "./SettingsMenu";

// The sections that report a connection/work status dot (the others are local
// views with no service to be "connected" to).
const DOTTED: ReadonlySet<string> = new Set([
  "host",
  "databases",
  "docker",
  "git",
  "activity",
]);

// Hover text for a dot level, so the rail explains itself.
const DOT_TITLE: Record<DotLevel, string> = {
  green: "connected",
  yellow: "available, not running",
  red: "error",
  grey: "not connected",
};

function levelFor(
  statuses: SectionStatuses | null,
  id: Section,
): DotLevel | null {
  if (!statuses || !DOTTED.has(id)) return null;
  return statuses[id as keyof SectionStatuses];
}

// Where the suggestions button sends people: the repo's new-issue page with the
// suggestion template preselected. A fixed https URL through the validated
// host:openExternal channel (http(s)-only, main-side shell.openExternal), so
// this adds no new IPC and no new security surface.
const SUGGESTIONS_URL =
  "https://github.com/RicardoRamosT/Airlock-IDE/issues/new?template=suggestion.yml";

// The vertical icon rail at the window edge: one icon per VISIBLE sidebar
// section. Click = show that view (re-opening the sidebar if collapsed); click
// the active icon = collapse the sidebar (same sidebarVisible flag the layout
// button and View menu drive -- no second collapse state). Right-click = hide
// the section (same action the old accordion header offered). The app-global
// Accounts/Settings buttons live at the rail bottom, rendered once per window.
export function ActivityBar() {
  const vis = useApp((s) => s.sectionVisibility);
  const sectionMeta = useApp((s) => s.sectionMeta);
  const activeView = useApp((s) => s.activeView);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const statuses = useSectionStatuses();
  // Accounts-button dot: green = the account this repo wants is the one in play,
  // yellow = a different account is active (a push here would use the wrong one).
  const [ghDot, refreshGhDot] = useGithubAccountDot();
  const [open, setOpen] = useState<"accounts" | "settings" | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    id: Section;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // Switching or pinning happens inside the Accounts popover, so re-read the dot
  // when it CLOSES instead of making the user wait out the poll interval. Keyed
  // on "was open" so unrelated popover traffic (Settings) never triggers a fetch.
  const accountsWasOpen = useRef(false);
  useEffect(() => {
    if (open === "accounts") accountsWasOpen.current = true;
    else if (accountsWasOpen.current) {
      accountsWasOpen.current = false;
      refreshGhDot();
    }
  }, [open, refreshGhDot]);

  const view = effectiveView(activeView, vis, sectionMeta);

  const onIcon = (id: Section) => {
    const s = useApp.getState();
    // A user choice must survive a still-in-flight startup prefs hydrate (the
    // same race the layout buttons guard against).
    s.setLayoutHydrated(true);
    if (id === view && sidebarVisible) {
      s.setSidebarVisible(false);
      void window.airlock.prefsSet({ sidebarVisible: false });
      return;
    }
    s.setActiveView(id);
    if (!sidebarVisible) s.setSidebarVisible(true);
    void window.airlock.prefsSet({ activeView: id, sidebarVisible: true });
  };

  return (
    <nav className="activity-bar">
      <div className="activity-bar-icons">
        {sectionMeta
          .filter((m) => vis[m.id])
          .map((m, i, shown) => {
            const level = levelFor(statuses, m.id);
            // A hairline before the FIRST extension icon, so the rail reads as
            // built-ins then extensions rather than one ever-growing list.
            const firstExt =
              m.kind === "extension" &&
              (i === 0 || shown[i - 1]?.kind === "builtin");
            return (
              <Fragment key={m.id}>
                {firstExt && <div className="activity-bar-divider" />}
                <button
                  type="button"
                  className={`activity-icon${m.id === view && sidebarVisible ? " active" : ""}`}
                  title={level ? `${m.label} — ${DOT_TITLE[level]}` : m.label}
                  onClick={() => onIcon(m.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      id: m.id,
                      label: m.label,
                    });
                  }}
                >
                  <span className="activity-icon-glyph">
                    <i className={`codicon codicon-${m.icon}`} />
                    {level && <span className={`activity-dot ${level}`} />}
                  </span>
                </button>
              </Fragment>
            );
          })}
      </div>
      <div className="activity-bar-bottom">
        {open !== null && (
          <button
            type="button"
            className="popover-backdrop"
            aria-label="Close menu"
            onClick={() => setOpen(null)}
          />
        )}
        <button
          type="button"
          className="footer-btn"
          title="Send a suggestion"
          onClick={() => void window.airlock.hostOpenExternal(SUGGESTIONS_URL)}
        >
          {/* A plain speech bubble: codicon-feedback draws a person BESIDE the
              bubble, which sat off-centre next to the account and gear glyphs. */}
          <i className="codicon codicon-comment" />
        </button>
        <button
          type="button"
          className={`footer-btn${open === "accounts" ? " active" : ""}`}
          title={`Accounts — ${ghDot.title}`}
          onClick={() => setOpen(open === "accounts" ? null : "accounts")}
        >
          <span className="activity-icon-glyph">
            <i className="codicon codicon-account" />
            <span className={`activity-dot ${ghDot.level}`} />
          </span>
        </button>
        <button
          type="button"
          className={`footer-btn${open === "settings" ? " active" : ""}`}
          title="Settings"
          onClick={() => setOpen(open === "settings" ? null : "settings")}
        >
          <i className="codicon codicon-gear" />
        </button>
        {open === "accounts" && (
          <AccountsPopover onClose={() => setOpen(null)} />
        )}
        {open === "settings" && <SettingsMenu onClose={() => setOpen(null)} />}
      </div>
      {menu && (
        <>
          <button
            type="button"
            className="popover-backdrop"
            aria-label="Close menu"
            onClick={() => setMenu(null)}
          />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                void window.airlock.setSectionVisibility(menu.id, false);
                setMenu(null);
              }}
            >
              <span>Hide {menu.label}</span>
            </button>
          </div>
        </>
      )}
    </nav>
  );
}
