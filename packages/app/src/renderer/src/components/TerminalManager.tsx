import { useApp } from "../store";
import { ProjectTerminals } from "./ProjectTerminals";

// Renders EVERY tab's terminals at once -- one ProjectTerminals subtree per tab,
// each wrapped in a slot that is hidden (display:none) unless it is the active
// tab. Keeping inactive tabs MOUNTED is the whole point: a pty dies only on
// TerminalPane unmount, so a hidden tab's shells keep running across switches.
//
// The window always has >= 1 tab (a blank tab covers the no-folder state with a
// real id), so there is no implicit-tab special case: a blank tab renders its
// own ProjectTerminals subtree like any other tab.
export function TerminalManager() {
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);

  // Each rendered subtree's tab id + whether it is the visible (active) one.
  const slots: { id: string; active: boolean }[] = tabs.map((t) => ({
    id: t.id,
    active: t.id === activeTabId,
  }));

  return (
    <div className="terminal-projects">
      {slots.map((slot) => (
        <div
          key={slot.id}
          className={`terminal-project-slot${slot.active ? "" : " hidden"}`}
        >
          <ProjectTerminals tabId={slot.id} />
        </div>
      ))}
    </div>
  );
}
