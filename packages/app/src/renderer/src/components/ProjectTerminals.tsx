import { useEffect, useRef } from "react";
import { EMPTY_TAB_TERMINALS, useApp } from "../store";
import { TerminalPane } from "./TerminalPane";
import { TerminalTabs } from "./TerminalTabs";

// One project's terminal subtree (the old TerminalManager body), scoped to a
// single tab's `tabTerminals[tabId]`. TerminalManager renders one of these per
// tab and keeps them ALL mounted, hiding inactive ones via CSS so their ptys
// stay alive across tab switches (a pty dies only when its TerminalPane
// unmounts). The auto-respawn-when-empty effect keys on THIS tab's terminal
// list, so a fresh tab gets exactly one terminal and a backgrounded empty tab
// does not respawn spuriously.
export function ProjectTerminals({ tabId }: { tabId: string }) {
  // Each selector reads this tab's slice. The empty fallback is a stable
  // reference so an absent tab id does not churn the selector identity.
  const terminals = useApp(
    (s) => (s.tabTerminals[tabId] ?? EMPTY_TAB_TERMINALS).terminals,
  );
  const activeTerminalId = useApp(
    (s) => (s.tabTerminals[tabId] ?? EMPTY_TAB_TERMINALS).activeTerminalId,
  );
  const splitTerminalId = useApp(
    (s) => (s.tabTerminals[tabId] ?? EMPTY_TAB_TERMINALS).splitTerminalId,
  );
  const addTerminal = useApp((s) => s.addTerminal);
  const activeTabId = useApp((s) => s.activeTabId);

  // Always keep at least one terminal alive in THIS tab. The ref guards against
  // React 19 StrictMode replaying this mount effect with a stale (length === 0)
  // closure, which would otherwise spawn two default tabs (and two PTYs) on
  // boot. The guard is armed only while the list is empty and cleared once a
  // terminal exists, so killing the last tab still respawns a fresh one.
  //
  // addTerminal acts on the ACTIVE tab, so only respawn for the tab that is
  // currently active (an empty background tab must not steal the respawn and
  // spawn into itself). A blank tab is a real tab, so it matches activeTabId
  // directly when it is the active one.
  const isActive = tabId === activeTabId;
  const spawningDefault = useRef(false);
  useEffect(() => {
    if (terminals.length > 0) {
      spawningDefault.current = false;
      return;
    }
    if (!isActive) return;
    if (spawningDefault.current) return;
    spawningDefault.current = true;
    addTerminal();
  }, [terminals.length, addTerminal, isActive]);

  const visible = (id: string) =>
    id === activeTerminalId || id === splitTerminalId;

  return (
    <div className="terminal-manager">
      <TerminalTabs tabId={tabId} />
      <div className={`terminal-panes${splitTerminalId ? " split" : ""}`}>
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`terminal-pane-slot${visible(t.id) ? "" : " hidden"}`}
          >
            <TerminalPane terminalId={t.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
