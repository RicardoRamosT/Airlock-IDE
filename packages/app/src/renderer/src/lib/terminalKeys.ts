// Translate macOS line-editing chords into the control bytes a shell readline /
// the Claude Code prompt understand. Pure (operates on plain modifier booleans,
// not a live DOM event) so it is unit-testable; TerminalPane wires it into
// xterm's attachCustomKeyEventHandler. Returns null to mean "not ours -- let
// xterm handle the key normally" (plain typing, Cmd+C/V, plain arrows/Enter).
//
// Each match requires EXACT modifiers so a normal key is never shadowed: e.g.
// Option+e (a special char) and Cmd+Shift+Arrow (a selection) both fall
// through to null.
export interface TermKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}

export function terminalKeyBytes(e: TermKeyEvent): string | null {
  const onlyMeta = e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey;
  const onlyAlt = e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
  const onlyShift = e.shiftKey && !e.metaKey && !e.altKey && !e.ctrlKey;

  if (onlyShift && e.key === "Enter") return "\x1b\r"; // newline, no submit

  if (onlyMeta) {
    if (e.key === "ArrowLeft") return "\x01"; // Ctrl-A: line start
    if (e.key === "ArrowRight") return "\x05"; // Ctrl-E: line end
    if (e.key === "Backspace") return "\x15"; // Ctrl-U: kill to line start
    if (e.key === "Delete") return "\x0b"; // Ctrl-K: kill to line end
  }
  if (onlyAlt) {
    if (e.key === "ArrowLeft") return "\x1bb"; // Meta-b: word back
    if (e.key === "ArrowRight") return "\x1bf"; // Meta-f: word forward
    if (e.key === "Backspace") return "\x1b\x7f"; // Meta-DEL: kill prev word
    if (e.key === "Delete") return "\x1bd"; // Meta-d: kill next word
  }
  return null;
}
