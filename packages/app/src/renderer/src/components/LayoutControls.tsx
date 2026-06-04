import { useApp } from "../store";

export function LayoutControls() {
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const toggleSidebarPosition = useApp((s) => s.toggleSidebarPosition);

  // Persist the two app-global prefs on change.
  const onToggleSidebar = () => {
    useApp.getState().setLayoutHydrated(true);
    const next = !sidebarVisible;
    toggleSidebar();
    void window.airlock.prefsSet({ sidebarVisible: next });
  };
  const onFlip = () => {
    useApp.getState().setLayoutHydrated(true);
    const next = sidebarPosition === "left" ? "right" : "left";
    toggleSidebarPosition();
    void window.airlock.prefsSet({ sidebarPosition: next });
  };

  const sideIcon = sidebarPosition === "left" ? "left" : "right";
  return (
    <div className="layout-controls">
      <button
        type="button"
        className="layout-btn"
        title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        onClick={onToggleSidebar}
      >
        <i
          className={`codicon codicon-layout-sidebar-${sideIcon}${sidebarVisible ? "" : "-off"}`}
        />
      </button>
      <button
        type="button"
        className="layout-btn"
        title={`Move sidebar ${sidebarPosition === "left" ? "right" : "left"}`}
        onClick={onFlip}
      >
        <i className="codicon codicon-arrow-swap" />
      </button>
    </div>
  );
}
