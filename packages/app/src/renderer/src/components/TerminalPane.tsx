import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

export function TerminalPane() {
  const hostRef = useRef<HTMLDivElement>(null);

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

    let disposed = false;
    let ptyId: string | null = null;
    let offData = () => {};
    let offExit = () => {};

    window.airlock
      .ptyCreate(term.cols, term.rows)
      .then((id) => {
        if (disposed) return; // late resolve after cleanup: do not subscribe
        ptyId = id;
        offData = window.airlock.onPtyData((e) => {
          if (e.id === id) term.write(e.data);
        });
        offExit = window.airlock.onPtyExit((e) => {
          if (e.id === id) term.write("\r\n[session ended]\r\n");
        });
      })
      .catch(console.error);

    const input = term.onData((data) => {
      if (ptyId) window.airlock.ptyInput(ptyId, data);
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ptyId) window.airlock.ptyResize(ptyId, term.cols, term.rows);
    });
    ro.observe(host);

    return () => {
      disposed = true;
      // TODO(agent-core): send pty:kill for the in-flight session once that channel exists — it orphans in main until quit
      ro.disconnect();
      input.dispose();
      offData();
      offExit();
      term.dispose();
    };
  }, []);

  return <div ref={hostRef} className="terminal-host" />;
}
