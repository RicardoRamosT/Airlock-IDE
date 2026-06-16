import type { TermKeyEvent } from "./terminalKeys";

// Editor-style selection chords for the terminal's current line. Mirrors the
// exact-modifier style of terminalKeyBytes: only these four chords match;
// everything else returns null so the caller falls through unchanged.
export type SelectChord = "lineStart" | "lineEnd" | "wordLeft" | "wordRight";

export function terminalSelectChord(e: TermKeyEvent): SelectChord | null {
  const cmdShift = e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey;
  const optShift = e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey;
  if (cmdShift && e.key === "ArrowLeft") return "lineStart";
  if (cmdShift && e.key === "ArrowRight") return "lineEnd";
  if (optShift && e.key === "ArrowLeft") return "wordLeft";
  if (optShift && e.key === "ArrowRight") return "wordRight";
  return null;
}

// Words are runs of [A-Za-z0-9_] (matches readline Meta-b/f used by the
// existing Option+Arrow move chords); everything else is a separator.
const isWord = (ch: string | undefined): boolean =>
  ch !== undefined && /[A-Za-z0-9_]/.test(ch);

// Move left: skip separators, then the word; land at the word's start.
export function prevWord(text: string, i: number): number {
  let j = Math.max(0, Math.min(i, text.length));
  while (j > 0 && !isWord(text[j - 1])) j--;
  while (j > 0 && isWord(text[j - 1])) j--;
  return j;
}

// Move right: skip separators, then the word; land just past the word's end.
export function nextWord(text: string, i: number): number {
  let j = Math.max(0, Math.min(i, text.length));
  while (j < text.length && !isWord(text[j])) j++;
  while (j < text.length && isWord(text[j])) j++;
  return j;
}

export interface SelState {
  cursorCol: number;
  lineLen: number;
  lineText: string;
  anchor: number | null;
  activeEnd: number | null;
}

// Compute the new {anchor, activeEnd} (logical column offsets). A fresh
// selection anchors at the cursor; word chords extend from the active end.
export function planSelection(
  s: SelState,
  chord: SelectChord,
): { anchor: number; activeEnd: number } {
  const anchor = s.anchor ?? s.cursorCol;
  const from = s.activeEnd ?? s.cursorCol;
  let activeEnd: number;
  switch (chord) {
    case "lineStart":
      activeEnd = 0;
      break;
    case "lineEnd":
      activeEnd = s.lineLen;
      break;
    case "wordLeft":
      activeEnd = prevWord(s.lineText, from);
      break;
    case "wordRight":
      activeEnd = nextWord(s.lineText, from);
      break;
  }
  return { anchor, activeEnd };
}
