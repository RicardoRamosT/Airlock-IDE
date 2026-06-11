import { useEffect, useState } from "react";
import type { Section } from "../../../shared/ipc";
import { effectiveView, SECTION_META } from "../lib/sections";
import { useApp } from "../store";
import { AccountsPopover } from "./AccountsPopover";
import { SettingsMenu } from "./SettingsMenu";

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
  const activeView = useApp((s) => s.activeView);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
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

  const view = effectiveView(activeView, vis);

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
        {SECTION_META.filter((m) => vis[m.id]).map((m) => (
          <button
            key={m.id}
            type="button"
            className={`activity-icon${m.id === view && sidebarVisible ? " active" : ""}`}
            title={m.label}
            onClick={() => onIcon(m.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, id: m.id, label: m.label });
            }}
          >
            <i className={`codicon codicon-${m.icon}`} />
          </button>
        ))}
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
          <i className="codicon codicon-feedback" />
        </button>
        <button
          type="button"
          className={`footer-btn${open === "accounts" ? " active" : ""}`}
          title="Accounts"
          onClick={() => setOpen(open === "accounts" ? null : "accounts")}
        >
          <i className="codicon codicon-account" />
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
