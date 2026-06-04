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

    // Hold the resolved pty id in a ref so the data/exit listeners (attached
    // synchronously below, before ptyCreate even resolves) can filter on it
    // once it is known. Register-first closes the lost-output race: main wires
    // s.onData -> wc.send inside pty:create before returning the id, so any
    // early shell-prompt bytes were dropped while the old code was still
    // waiting in the .then to subscribe. Listeners now exist before the invoke
    // resolves, so the renderer is already listening when the id arrives.
    //
    // But "id === idRef.current" alone still drops the very first bytes: the
    // shell prompt is emitted as soon as main starts forwarding, which can be
    // BEFORE the ptyCreate promise resolves and sets idRef. Those events fail
    // the id check and vanish. So buffer any pre-adopt bytes and flush them on
    // adopt. This is safe without keying on id because each TerminalPane owns
    // its own preload subscription and has exactly one in-flight ptyCreate, so
    // any pre-adopt pty:data reaching THIS pane's listener belongs to THIS pane.
    const idRef = { current: null as string | null };
    let exited = false;
    let disposed = false;
    const pending: string[] = [];

    // Renderer-side flow control. xterm's write(data, cb) fires cb once that
    // chunk is parsed/flushed, so we can count outstanding (unflushed) bytes.
    // When the backlog crosses the high-water mark we send XOFF (\x13) over the
    // pty input channel; session.ts spawns with handleFlowControl, so node-pty
    // intercepts that marker and pause()s the child - real backpressure under a
    // flood (e.g. cat-ing a huge file). When the backlog drains below the
    // low-water mark the flush callback sends XON (\x11) to resume(). The
    // hysteresis gap (HIGH vs LOW) avoids thrashing pause/resume on every chunk.
    let unflushed = 0;
    let paused = false;
    const HIGH = 1_000_000; // ~1MB outstanding -> pause the child
    const LOW = 100_000; // drained below this -> resume the child
    const writeChunk = (data: string) => {
      unflushed += data.length;
      if (!paused && unflushed > HIGH && idRef.current) {
        paused = true;
        window.airlock.ptyInput(idRef.current, "\x13"); // XOFF -> node-pty pause()
      }
      term.write(data, () => {
        unflushed -= data.length;
        if (paused && unflushed < LOW && idRef.current) {
          paused = false;
          window.airlock.ptyInput(idRef.current, "\x11"); // XON -> node-pty resume()
        }
      });
    };

    const offData = window.airlock.onPtyData((e) => {
      if (idRef.current === null) {
        pending.push(e.data);
        return;
      }
      if (e.id === idRef.current) writeChunk(e.data);
    });
    const offExit = window.airlock.onPtyExit((e) => {
      if (e.id === idRef.current) {
        exited = true;
        removeTerminal(terminalId);
      }
    });

    window.airlock
      .ptyCreate(term.cols, term.rows)
      .then((id) => {
        if (disposed) {
          // Late resolve after unmount: the session would orphan; kill it.
          // Return BEFORE flushing - the terminal is gone, so pending bytes
          // must not be written into a disposed instance.
          window.airlock.ptyKill(id);
          return;
        }
        idRef.current = id;
        // Flush pre-adopt bytes now that the id is known. Route through
        // writeChunk so buffered output also counts toward the flow-control
        // high-water mark.
        for (const d of pending) writeChunk(d);
        pending.length = 0;
        setTerminalPty(terminalId, id);
      })
      .catch((err) => {
        console.error(err);
        // Failed spawn must not leave a zombie tab with no backing pty.
        removeTerminal(terminalId);
      });

    const input = term.onData((data) => {
      if (idRef.current) window.airlock.ptyInput(idRef.current, data);
    });

    const title = term.onTitleChange((t) => {
      if (t.trim()) setTerminalTitle(terminalId, t, false);
    });

    // Trailing debounce so a window drag does not fire dozens of fit() +
    // ptyResize IPC calls; the 0x0 hidden-pane guard stays inside the
    // debounced fn so a tab hidden mid-drag is still skipped.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (host.clientWidth === 0 || host.clientHeight === 0) return; // hidden tab
        fit.fit();
        if (idRef.current)
          window.airlock.ptyResize(idRef.current, term.cols, term.rows);
      }, 50);
    });
    ro.observe(host);

    return () => {
      disposed = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      input.dispose();
      title.dispose();
      offData();
      offExit();
      // Tab closed / root changed: the session must die with the pane.
      if (idRef.current && !exited) window.airlock.ptyKill(idRef.current);
      term.dispose();
    };
  }, [terminalId, setTerminalPty, setTerminalTitle, removeTerminal]);

  return <div ref={hostRef} className="terminal-host" />;
}
