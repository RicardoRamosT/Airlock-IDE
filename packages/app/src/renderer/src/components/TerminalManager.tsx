import { useCallback, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ProjectPaneContext } from "../lib/projectPane";
import { useTerminalSlots } from "../lib/terminalSlots";
import { useApp } from "../store";
import { ProjectTerminals } from "./ProjectTerminals";

// Renders EVERY tab's terminals once, mounted exactly ONCE at the app root, and
// keeps them alive across split toggles / focus swaps / tab switches. A pty dies
// only when its TerminalPane unmounts, so the terminals must NOT remount when the
// layout changes.
//
// CRITICAL (this was a bug): React portals REMOUNT their children when the
// portal's CONTAINER changes. So we must NOT re-point a single createPortal at
// different pane slots -- doing that remounted ProjectTerminals on every split /
// switch and killed the running terminal (closed Claude). Instead each tab gets
// ONE stable detached host node; createPortal renders into THAT node (the
// container never changes -> the content never remounts), and we relocate the
// node between pane slots (or a hidden keep-alive) with appendChild -- a DOM
// reparent that leaves the React tree untouched. (The react-reverse-portal
// pattern, inlined.)
export function TerminalManager() {
  const tabs = useApp((s) => s.tabs);
  const { slots } = useTerminalSlots();
  const keepAliveRef = useRef<HTMLDivElement>(null);
  // One stable host node per tab id, created lazily and reused forever. Reads
  // only the (stable) ref, so it has no reactive deps -- useCallback([]) keeps a
  // stable identity so the layout effect below does not re-run every render.
  const nodesRef = useRef(new Map<string, HTMLDivElement>());
  const nodeFor = useCallback((tabId: string): HTMLDivElement => {
    const map = nodesRef.current;
    let node = map.get(tabId);
    if (!node) {
      node = document.createElement("div");
      node.className = "terminal-host-node";
      map.set(tabId, node);
    }
    return node;
  }, []);

  // After each render, move every tab's stable node into its current pane slot
  // (or the hidden keep-alive when the tab is not visible). appendChild relocates
  // the node WITHOUT changing the createPortal container, so ProjectTerminals --
  // and its ptys -- are never torn down. Layout effect so the move lands before
  // paint. Also GC nodes for tabs that no longer exist.
  useLayoutEffect(() => {
    const keepAlive = keepAliveRef.current;
    for (const tab of tabs) {
      const node = nodeFor(tab.id);
      const target = slots[tab.id] ?? keepAlive;
      if (target && node.parentElement !== target) target.appendChild(node);
    }
    const live = new Set(tabs.map((t) => t.id));
    for (const [id, node] of nodesRef.current) {
      if (!live.has(id)) {
        node.remove();
        nodesRef.current.delete(id);
      }
    }
  }, [tabs, slots, nodeFor]);

  return (
    <>
      <div ref={keepAliveRef} className="terminal-keepalive" aria-hidden />
      {tabs.map((tab) =>
        createPortal(
          <ProjectPaneContext.Provider value={tab.id}>
            <ProjectTerminals tabId={tab.id} />
          </ProjectPaneContext.Provider>,
          nodeFor(tab.id),
          tab.id,
        ),
      )}
    </>
  );
}
