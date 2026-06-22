import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { openEditorFile } from "../lib/editorFiles";
import { useProjectTab } from "../lib/projectPane";
import { terminalKeyBytes } from "../lib/terminalKeys";
import { linksForRows, resolveRel } from "../lib/terminalLinks";
import {
  keepsSelection,
  planSelection,
  type SelectChord,
  terminalSelectChord,
} from "../lib/terminalSelect";
import {
  hasReadyIndicator,
  hasWorkingIndicator,
} from "../lib/workingIndicator";
import { CLAUDE_AUTO_COMMAND, useApp } from "../store";

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
  // The PANE's tab (ProjectPane provides it), so the spawn below can pass THIS
  // pane's root instead of letting main fall back to the window root -- which
  // can still point at the previously focused project when a blank tab opens.
  const tabId = useProjectTab();
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
  // Last ready state pushed to the store, so the scan only calls applyPtyReady
  // on a change (not every tick).
  const lastReadyRef = useRef(false);
  const selAnchorRef = useRef<number | null>(null);
  const selActiveRef = useRef<number | null>(null);
  const setTerminalPty = useApp((s) => s.setTerminalPty);
  const setTerminalTitle = useApp((s) => s.setTerminalTitle);
  const removeTerminal = useApp((s) => s.removeTerminal);
  const theme = useApp((s) => s.theme);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Clear the keyboard-selection anchor (called when a non-selection key ends it).
    const resetSelAnchor = () => {
      selAnchorRef.current = null;
      selActiveRef.current = null;
    };

    // Apply a selection chord to the focused terminal's CURRENT logical line.
    // Reads the shell cursor + the (wrap-joined) line, plans the new range with the
    // pure planner, and highlights it via xterm. Visual only -- never touches the pty.
    const applySelectionChord = (term: Terminal, chord: SelectChord) => {
      // If our previous selection was cleared externally (mouse click, output,
      // focus loss), start fresh instead of extending a stale anchor.
      if (selAnchorRef.current !== null && !term.hasSelection())
        resetSelAnchor();
      const buf = term.buffer.active;
      const cols = term.cols;
      const cursorRow = buf.baseY + buf.cursorY;
      // Logical line = the cursor row plus any rows it wrapped across.
      let startRow = cursorRow;
      while (startRow > 0 && buf.getLine(startRow)?.isWrapped) startRow--;
      let endRow = cursorRow;
      while (buf.getLine(endRow + 1)?.isWrapped) endRow++;
      let joined = "";
      for (let r = startRow; r <= endRow; r++) {
        joined += buf.getLine(r)?.translateToString(false) ?? "";
      }
      const lineText = joined.replace(/\s+$/, ""); // drop trailing grid padding
      const lineLen = lineText.length;
      const cursorCol = Math.min(
        (cursorRow - startRow) * cols + buf.cursorX,
        lineLen,
      );
      const next = planSelection(
        {
          cursorCol,
          lineLen,
          lineText,
          anchor: selAnchorRef.current,
          activeEnd: selActiveRef.current,
        },
        chord,
      );
      selAnchorRef.current = next.anchor;
      selActiveRef.current = next.activeEnd;
      const lo = Math.min(next.anchor, next.activeEnd);
      const hi = Math.max(next.anchor, next.activeEnd);
      if (lo === hi) {
        term.clearSelection();
        return;
      }
      const row = startRow + Math.floor(lo / cols);
      const col = lo % cols;
      term.select(col, row, hi - lo);
    };

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

    // Cmd+click file links: underline paths that resolve to an existing FILE
    // under the project root; Cmd+click opens them in the editor (revealing a
    // parsed :line). A per-terminal cache of known-existing paths bounds the
    // existence IPC. Plain clicks stay normal (activate is metaKey-gated), and
    // term.dispose() (cleanup) disposes this provider with the terminal.
    const existsCache = new Set<string>();
    term.registerLinkProvider({
      provideLinks(lineNo, callback) {
        const root = useApp.getState().tabState[tabId]?.root ?? null;
        if (!root) {
          callback(undefined);
          return;
        }
        const buf = term.buffer.active;
        const cols = term.cols;
        const y0 = lineNo - 1; // 0-based queried row
        // Reconstruct the LOGICAL line this row belongs to: xterm soft-wraps
        // long output (e.g. Claude's TUI) across rows flagged `isWrapped`, so a
        // path split across rows is invisible to per-row scanning. Only scan a
        // small window around the hovered row (a path spans few rows), so this
        // stays cheap even for a very long wrapped block.
        let start = y0;
        while (start > 0 && buf.getLine(start)?.isWrapped) start--;
        let end = y0;
        while (buf.getLine(end + 1)?.isWrapped) end++;
        const RADIUS = 3;
        const winStart = Math.max(start, y0 - RADIUS);
        const winEnd = Math.min(end, y0 + RADIUS);
        const rows: string[] = [];
        for (let r = winStart; r <= winEnd; r++)
          rows.push(buf.getLine(r)?.translateToString(false) ?? "");
        const cands = linksForRows(rows, cols, winStart)
          .filter((l) => l.startY <= lineNo && lineNo <= l.endY) // covers this row
          .flatMap((l) => {
            const rel = resolveRel(root, l.path);
            return rel ? [{ l, rel }] : [];
          });
        if (cands.length === 0) {
          callback(undefined);
          return;
        }
        void Promise.all(
          cands.map(async ({ l, rel }) => {
            const key = `${root}\n${rel}`;
            let ok = existsCache.has(key);
            if (!ok) {
              ok = await window.airlock.exists(root, rel).catch(() => false);
              if (ok) existsCache.add(key);
            }
            if (!ok) return null;
            return {
              text: l.text,
              range: {
                start: { x: l.startX, y: l.startY },
                end: { x: l.endX, y: l.endY },
              },
              decorations: { pointerCursor: true, underline: true },
              activate: (event: MouseEvent) => {
                if (!event.metaKey) return; // Cmd+click only; plain click = normal
                void openEditorFile(tabId, rel);
                if (l.line) useApp.getState().revealLine(tabId, rel, l.line);
              },
            };
          }),
        ).then((links) =>
          callback(links.filter((x): x is NonNullable<typeof x> => x !== null)),
        );
      },
    });

    // macOS line-editing chords -> readline control bytes (see lib/terminalKeys).
    // Matched chords are sent straight to the pty and suppressed in xterm (and
    // the browser); everything else (typing, Cmd+C/V, plain arrows/Enter, IME)
    // returns true and behaves exactly as before. Fires only for THIS focused
    // terminal, so the CodeMirror editor's native keys are untouched.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const bytes = terminalKeyBytes(e);
      if (bytes !== null) {
        if (idRef.current) window.airlock.ptyInput(idRef.current, bytes);
        term.clearSelection(); // a move/edit chord ends the keyboard selection
        resetSelAnchor();
        e.preventDefault();
        return false;
      }
      // Only act on the shell's NORMAL buffer. In the alt buffer (vim/less/htop)
      // these chords belong to the TUI -- fall through so it receives them.
      const chord = terminalSelectChord(e);
      if (chord && term.buffer.active.type === "normal") {
        applySelectionChord(term, chord);
        e.preventDefault();
        return false;
      }
      // Cmd+C copies the highlight when there is one (Ctrl+C / SIGINT is unaffected).
      if (
        e.metaKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        (e.key === "c" || e.key === "C") &&
        term.hasSelection()
      ) {
        navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        e.preventDefault();
        return false;
      }
      // Bare modifiers, lock, and dead keys must NOT end the selection (pressing
      // Cmd before Cmd+C, or AltGraph/Dead to type a special char mid-selection,
      // has to keep the highlight + anchor). Any real key clears both.
      if (keepsSelection(e.key)) return true;
      term.clearSelection();
      resetSelAnchor();
      return true;
    });

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
    // the id check and vanish. So buffer pre-adopt events and replay them on
    // adopt -- but pty:data is a per-WINDOW broadcast (every mounted pane's
    // listener sees EVERY pty's data), so the buffer keeps each {id,data} and on
    // adopt replays ONLY this pane's id. Buffering raw bytes (the old code) wrote
    // a sibling pane's output -- racing our pre-adopt window -- into this xterm.
    // (audit PB-H2)
    // idRef is the component-level ref declared above (shared with the scan
    // effect); reset it here so a remount of this pane starts unadopted.
    idRef.current = null;
    let exited = false;
    let disposed = false;
    const pending: { id: string; data: string }[] = [];

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
        pending.push(e); // pre-adopt: keep {id,data}, filter on adopt (PB-H2)
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

    // Spawn in THIS pane's project (null = blank tab -> $HOME, no secrets).
    // Read via getState at spawn time: cwd is a spawn-time property, and a
    // root change kills/remounts the pane anyway, so it must not be a dep.
    const paneRoot = useApp.getState().tabState[tabId]?.root ?? null;
    window.airlock
      .ptyCreate(term.cols, term.rows, paneRoot)
      .then((id) => {
        if (disposed) {
          // Late resolve after unmount: the session would orphan; kill it.
          // Return BEFORE flushing - the terminal is gone, so pending bytes
          // must not be written into a disposed instance.
          window.airlock.ptyKill(id);
          return;
        }
        idRef.current = id;
        // Flush pre-adopt bytes now that the id is known -- but ONLY this pane's
        // (pty:data is a per-window broadcast, so the buffer may also hold
        // sibling panes' output). Route through writeChunk so buffered output
        // also counts toward the flow-control high-water mark.
        for (const ev of pending) {
          if (ev.id === id) writeChunk(ev.data);
        }
        pending.length = 0;
        setTerminalPty(terminalId, id);
        // Auto-start claude when the store grants it (mode/blank-tab/claim
        // logic lives there). Typed-ahead bytes sit in the pty buffer until
        // zsh reads them, so shell startup timing cannot drop the command.
        // A queued command (an integration Install button) pre-empts claude
        // auto-start, so the install terminal runs only the install.
        const queued = useApp.getState().takePendingTerminalCommand(terminalId);
        if (queued) {
          window.airlock.ptyInput(id, queued);
        } else if (useApp.getState().claudeAutoDecision(terminalId)) {
          window.airlock.ptyInput(id, CLAUDE_AUTO_COMMAND);
        }
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
  }, [terminalId, tabId, setTerminalPty, setTerminalTitle, removeTerminal]);

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
    const timer = setInterval(() => {
      const term = termRef.current;
      const ptyId = idRef.current;
      if (!term || !ptyId) return;
      const buf = term.buffer.active;
      // Read the LIVE bottom of the terminal -- the last (rows + 2) buffer lines,
      // where Claude's status line sits. Index off buffer.length, NOT baseY:
      // baseY's scroll/scrollback semantics were reading the wrong region, so the
      // dot never lit even with "esc to interrupt" plainly on screen.
      const total = buf.length;
      const span = Math.min(total, (term.rows || 24) + 2);
      let text = "";
      for (let y = total - span; y < total; y++) {
        text += `${buf.getLine(y)?.translateToString(true) ?? ""} `;
      }
      // hasWorkingIndicator collapses whitespace (wrapped footer) and tolerates
      // the width truncation a narrow split pane forces ("esc to interru...").
      const working = hasWorkingIndicator(text);
      if (working !== lastWorkingRef.current) {
        lastWorkingRef.current = working;
        useApp.getState().applyPtyStatus(ptyId, working);
      }
      const ready = hasReadyIndicator(text);
      if (ready !== lastReadyRef.current) {
        lastReadyRef.current = ready;
        useApp.getState().applyPtyReady(ptyId, ready);
      }
    }, SCAN_MS);
    return () => clearInterval(timer);
  }, []);

  return <div ref={hostRef} className="terminal-host" />;
}
