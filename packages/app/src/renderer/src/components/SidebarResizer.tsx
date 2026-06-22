import type React from "react";
import {
  resizeSidebar,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from "../lib/sidebarResize";
import { useApp } from "../store";

const KEY_STEP = 16; // px the divider moves per Arrow keypress

// A thin draggable divider at the sidebar<->panes border. Dragging resizes the
// one shared sidebar LIVE by mutating the `--sidebar-w` CSS var on `.workspace`
// (the grid column + this handle both read it), so the layout reflows without a
// React render per mousemove; the final width commits to the store + prefs on
// release. Dragging past the collapse threshold hides the sidebar instead of
// pinning it at the min width. Double-click resets to the default width.
export function SidebarResizer() {
  const sidebarWidth = useApp((s) => s.sidebarWidth);
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  const setSidebarWidth = useApp((s) => s.setSidebarWidth);
  const setSidebarVisible = useApp((s) => s.setSidebarVisible);

  // Commit a final width to the store + prefs (shared by drag-release, keyboard,
  // and double-click). A user gesture must survive a still-in-flight startup
  // prefs hydrate, hence the layoutHydrated guard.
  const commitWidth = (width: number) => {
    useApp.getState().setLayoutHydrated(true);
    setSidebarWidth(width);
    void window.airlock.prefsSet({ sidebarWidth: width });
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const workspace = e.currentTarget.closest<HTMLElement>(".workspace");
    if (!workspace) return;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add("resizing-col");
    let next = { width: startWidth, collapse: false };

    const onMove = (ev: MouseEvent) => {
      next = resizeSidebar(startWidth, ev.clientX - startX, sidebarPosition);
      workspace.style.setProperty("--sidebar-w", `${next.width}px`);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing-col");
      if (next.collapse) {
        // Keep the persisted width so reopening restores the prior size; just
        // pin the live var back to it (the drag had shrunk it past the gate).
        workspace.style.setProperty("--sidebar-w", `${startWidth}px`);
        useApp.getState().setLayoutHydrated(true);
        setSidebarVisible(false);
        void window.airlock.prefsSet({ sidebarVisible: false });
      } else {
        commitWidth(next.width);
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Keyboard resize: Arrow Left/Right nudge the divider by a step in the SAME
  // physical sense as a drag (resizeSidebar applies the dock inversion). Keyboard
  // never collapses -- it clamps at the min instead.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = resizeSidebar(sidebarWidth, dir * KEY_STEP, sidebarPosition);
    if (!next.collapse) commitWidth(next.width);
  };

  const onDoubleClick = () => commitWidth(SIDEBAR_DEFAULT);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a splitter is a focusable, interactive ARIA "separator" widget; <hr> cannot carry the drag/keyboard handlers this needs.
    <div
      className={`sidebar-resizer sidebar-resizer-${sidebarPosition}`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={sidebarWidth}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      title="Drag to resize; double-click to reset"
    />
  );
}
