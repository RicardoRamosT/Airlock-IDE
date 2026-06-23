import { useApp } from "../store";

export function LayoutControls() {
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  const toggleSidebarPosition = useApp((s) => s.toggleSidebarPosition);

  // Persist the app-global pref on change. (Collapsing the sidebar is handled by
  // clicking the active icon in the ActivityBar, so no separate toggle here.)
  const onFlip = () => {
    useApp.getState().setLayoutHydrated(true);
    const next = sidebarPosition === "left" ? "right" : "left";
    toggleSidebarPosition();
    void window.airlock.prefsSet({ sidebarPosition: next });
  };

  return (
    <div className="layout-controls">
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
