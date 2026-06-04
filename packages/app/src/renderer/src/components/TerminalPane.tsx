import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useApp } from "../store";

export function TerminalPane({ terminalId }: { terminalId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const setTerminalPty = useApp((s) => s.setTerminalPty);
  const setTerminalTitle = useApp((s) => s.setTerminalTitle);
  const removeTerminal = useApp((s) => s.removeTerminal);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'SF Mono', Menlo, monospace",
      cursorBlink: true,
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#1f3a5f",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    let ptyId: string | null = null;
    let exited = false;
    let offData = () => {};
    let offExit = () => {};
    let disposed = false;

    window.airlock
      .ptyCreate(term.cols, term.rows)
      .then((id) => {
        if (disposed) {
          // Late resolve after unmount: the session would orphan; kill it.
          window.airlock.ptyKill(id);
          return;
        }
        ptyId = id;
        setTerminalPty(terminalId, id);
        offData = window.airlock.onPtyData((e) => {
          if (e.id === id) term.write(e.data);
        });
        offExit = window.airlock.onPtyExit((e) => {
          if (e.id === id) {
            exited = true;
            removeTerminal(terminalId);
          }
        });
      })
      .catch(console.error);

    const input = term.onData((data) => {
      if (ptyId) window.airlock.ptyInput(ptyId, data);
    });

    const title = term.onTitleChange((t) => {
      if (t.trim()) setTerminalTitle(terminalId, t, false);
    });

    const ro = new ResizeObserver(() => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return; // hidden tab
      fit.fit();
      if (ptyId) window.airlock.ptyResize(ptyId, term.cols, term.rows);
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      input.dispose();
      title.dispose();
      offData();
      offExit();
      // Tab closed / root changed: the session must die with the pane.
      if (ptyId && !exited) window.airlock.ptyKill(ptyId);
      term.dispose();
    };
  }, [terminalId, setTerminalPty, setTerminalTitle, removeTerminal]);

  return <div ref={hostRef} className="terminal-host" />;
}
