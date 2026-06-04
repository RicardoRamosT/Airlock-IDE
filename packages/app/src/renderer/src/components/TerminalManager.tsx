import { useEffect, useRef } from "react";
import { useApp } from "../store";
import { TerminalPane } from "./TerminalPane";
import { TerminalTabs } from "./TerminalTabs";

export function TerminalManager() {
  const terminals = useApp((s) => s.terminals);
  const activeTerminalId = useApp((s) => s.activeTerminalId);
  const splitTerminalId = useApp((s) => s.splitTerminalId);
  const addTerminal = useApp((s) => s.addTerminal);

  // Always keep at least one terminal alive. The ref guards against React 19
  // StrictMode replaying this mount effect with a stale (length === 0) closure,
  // which would otherwise spawn two default tabs (and two PTYs) on boot. The
  // guard is armed only while the list is empty and cleared once a terminal
  // exists, so killing the last tab still respawns a fresh one.
  const spawningDefault = useRef(false);
  useEffect(() => {
    if (terminals.length > 0) {
      spawningDefault.current = false;
      return;
    }
    if (spawningDefault.current) return;
    spawningDefault.current = true;
    addTerminal();
  }, [terminals.length, addTerminal]);

  const visible = (id: string) =>
    id === activeTerminalId || id === splitTerminalId;

  return (
    <div className="terminal-manager">
      <TerminalTabs />
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
