import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useApp } from "../store";

// xterm has no CSS-variable hook, so its palette must be supplied as a literal
// object. Mirror the two app palettes (theme.css :root / [data-theme=light]):
// dark = the original GitHub-dark terminal colors; light = the GitHub-light
// surface so the embedded terminal inverts with the rest of the UI.
const XTERM_THEMES: Record<"dark" | "light", ITheme> = {
  dark: {
    background: "#0d1117",
    foreground: "#c9d1d9",
    cursor: "#58a6ff",
    selectionBackground: "#1f3a5f",
  },
  light: {
    background: "#ffffff",
    foreground: "#1f2328",
    cursor: "#0969da",
    selectionBackground: "rgba(9, 105, 218, 0.18)",
  },
};

export function TerminalPane({ terminalId }: { terminalId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // The resolved pty id, shared between the main PTY-lifecycle effect (which sets
  // it once ptyCreate resolves) and the working-indicator scan effect below
  // (which reads it). A component-level ref so both effects see the same value;
  // a fresh mount gets a fresh ref, so no stale id can leak across remounts.
  const idRef = useRef<string | null>(null);
  // Last working state pushed to the store, so the scan only calls applyPtyStatus
  // on a change (not every tick).
  const lastWorkingRef = useRef(false);
  const setTerminalPty = useApp((s) => s.setTerminalPty);
  const setTerminalTitle = useApp((s) => s.setTerminalTitle);
  const removeTerminal = useApp((s) => s.removeTerminal);
  const theme = useApp((s) => s.theme);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'SF Mono', Menlo, monospace",
      cursorBlink: true,
      // Read the current theme at creation time (not via the effect deps) so
      // the first paint is correct without making this PTY-lifecycle effect
      // re-run on theme change. Live theme changes are handled by the separate
      // effect below, which just sets term.options.theme.
      theme: XTERM_THEMES[useApp.getState().theme],
    });
    termRef.current = term;
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
    // idRef is the component-level ref declared above (shared with the scan
    // effect); reset it here so a remount of this pane starts unadopted.
    idRef.current = null;
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
      termRef.current = null;
      idRef.current = null;
    };
  }, [terminalId, setTerminalPty, setTerminalTitle, removeTerminal]);

  // Live theme change: update the existing terminal's palette in place. xterm
  // applies options.theme immediately, so the PTY + buffer + flow-control
  // lifecycle above is preserved (no remount, no lost output). The main effect
  // does NOT depend on theme precisely so it never tears down the session here.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = XTERM_THEMES[theme];
  }, [theme]);

  // Per-tab Claude status: derive "working" from Claude Code's OWN on-screen
  // indicator rather than from output activity. While Claude is processing a
  // turn it shows an "esc to interrupt" status line near the bottom of the
  // terminal; when it finishes, that line is replaced by the input prompt. So
  // we periodically scan the rendered xterm buffer's bottom rows for that
  // marker -> working = marker present. This is accurate and inherently
  // Claude-scoped (Claude Code is the running process the whole session, so
  // "recent output" would false-trigger on every keystroke/redraw).
  //
  // Reads `baseY` (the top of the CURRENT screen) not the viewport scroll
  // position, so scrolling up into old scrollback never false-triggers. Scans
  // only the bottom ~10 rows: cheap, targeted (Claude's status line sits at the
  // bottom), and avoids matching the phrase elsewhere in history. Calls
  // applyPtyStatus ONLY on a change. Runs for background (hidden) panes too --
  // their xterm buffers keep updating from pty data while display:none, so the
  // finish-glow still fires for a tab the user is not looking at; the scan is
  // deliberately NOT gated on visibility. No secret surface: this reads the
  // user's own terminal buffer in the renderer to set a boolean; nothing
  // crosses to the agent.
  useEffect(() => {
    const SCAN_MS = 600;
    const BOTTOM_ROWS = 10;
    const timer = setInterval(() => {
      const term = termRef.current;
      const ptyId = idRef.current;
      if (!term || !ptyId) return;
      const buf = term.buffer.active;
      const rows = term.rows;
      const start = Math.max(0, rows - BOTTOM_ROWS);
      let text = "";
      for (let i = start; i < rows; i++) {
        text += `${buf.getLine(buf.baseY + i)?.translateToString(true) ?? ""}\n`;
      }
      const working = /esc to interrupt/i.test(text);
      if (working !== lastWorkingRef.current) {
        lastWorkingRef.current = working;
        useApp.getState().applyPtyStatus(ptyId, working);
      }
    }, SCAN_MS);
    return () => clearInterval(timer);
  }, []);

  return <div ref={hostRef} className="terminal-host" />;
}
