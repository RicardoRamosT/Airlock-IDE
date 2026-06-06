import { useState } from "react";
import { createPortal } from "react-dom";
import { ProjectPaneContext } from "../lib/projectPane";
import { useTerminalSlots } from "../lib/terminalSlots";
import { useApp } from "../store";
import { ProjectTerminals } from "./ProjectTerminals";

// Renders EVERY tab's terminals at once -- one ProjectTerminals subtree per tab
// -- and is mounted exactly ONCE at the app root (NOT inside a pane). Each
// subtree is React-PORTALED into the element a ProjectPane registered for that
// tab; tabs not currently in a visible pane portal into a single hidden
// keep-alive <div> instead.
//
// Keeping every tab's ProjectTerminals MOUNTED here is the whole point: a pty
// dies only when its TerminalPane unmounts. The React elements live in THIS
// component's stable tree forever; only their portal TARGET changes as split
// toggles / focus swaps / tabs switch. The DOM nodes move between containers
// (an element move, not a remount), so React never unmounts a TerminalPane and
// the ptys survive. The window always has >= 1 tab (a blank tab covers the
// no-folder state with a real id), so there is no implicit-tab special case.
//
// Each portal's content is wrapped in <ProjectPaneContext value={tabId}> so the
// per-pane chrome inside ProjectTerminals (the running-process notice etc.)
// resolves to the right tab when it renders into a split pane.
export function TerminalManager() {
  const tabs = useApp((s) => s.tabs);
  const { slots } = useTerminalSlots();
  // The fallback target for any tab not currently shown in a visible pane: one
  // stable hidden div (display:none) keeps those tabs' terminals mounted+alive.
  // A STATE-backed callback ref (not useRef) is required so that attaching the
  // div triggers a re-render -- a plain ref is null on first render and would
  // never let the portals mount (setting a ref does not re-render).
  const [keepAlive, setKeepAlive] = useState<HTMLDivElement | null>(null);

  return (
    <>
      <div ref={setKeepAlive} className="terminal-keepalive" aria-hidden />
      {tabs.map((tab) => {
        const target = slots[tab.id] ?? keepAlive;
        if (!target) return null; // keep-alive not attached yet (first paint)
        return (
          <ProjectPaneContext.Provider key={tab.id} value={tab.id}>
            {createPortal(<ProjectTerminals tabId={tab.id} />, target)}
          </ProjectPaneContext.Provider>
        );
      })}
    </>
  );
}
