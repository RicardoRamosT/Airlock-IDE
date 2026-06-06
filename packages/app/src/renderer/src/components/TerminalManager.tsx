import { IMPLICIT_TAB_ID, useApp } from "../store";
import { ProjectTerminals } from "./ProjectTerminals";

// Renders EVERY tab's terminals at once -- one ProjectTerminals subtree per tab,
// each wrapped in a slot that is hidden (display:none) unless it is the active
// tab. Keeping inactive tabs MOUNTED is the whole point: a pty dies only on
// TerminalPane unmount, so a hidden tab's shells keep running across switches.
//
// No-project state: when no project is open (activeTabId === null and no tabs),
// render a single implicit ProjectTerminals so the app still shows a working
// terminal -- matching today's behavior where a shell exists even with no folder
// open. As soon as a project opens, the implicit subtree unmounts (its scratch
// shell dies, exactly as opening a folder reset terminals before).
export function TerminalManager() {
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);

  // Each rendered subtree's tab id + whether it is the visible (active) one.
  const slots: { id: string; active: boolean }[] =
    tabs.length === 0
      ? [{ id: IMPLICIT_TAB_ID, active: true }]
      : tabs.map((t) => ({ id: t.id, active: t.id === activeTabId }));

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
