// Detects Claude Code's "working" state from its on-screen footer. While Claude
// processes a turn it shows a status line near the bottom of the terminal; the
// per-tab status dot is driven off it (see TerminalPane's buffer scan).
//
// This matcher has been re-broken repeatedly as Claude Code restyles that footer
// (see git history), so it now anchors on the ONE part that has survived every
// version: the live ELAPSED-SECONDS TIMER shown in parentheses while -- and only
// while -- Claude works: "(7s", "(83s", "(1m 5s". Everything else has churned:
//   - "esc to interrupt" was REMOVED in v2.1.199 (0 occurrences in the binary),
//     and even before that the hint rotated ("N tokens" / "thinking with xhigh
//     effort"), so it is absent for long stretches of real work.
//   - The "…" after the verb was ALSO gone by v2.1.199 (0 occurrences) -- that
//     is what silently broke the dot, since the old matcher required "verb… (Ns".
//   - The leading spinner glyph rotates through an ever-changing set (braille
//     "⠂", "✦", "+", "✻", …), so anchoring on it is a losing game.
// The idle footer ("? for shortcuts", "shift+tab to cycle") and finished
// summaries ("Churned for 6s") carry NO parenthetical "(Ns" timer, so the timer
// stays specific to the working state. (Known small cost: a stray "(Ns" in the
// bottom rows -- e.g. a build tool that prints "(2s)" -- can momentarily light
// the dot; transient and far rarer than the pervasive stuck-gray it fixes.)
//
// Width effects the caller/handler must tolerate: WRAP (the footer wraps across
// rows -> the caller joins rows and we collapse whitespace) and TRUNCATION (a
// narrow split abbreviates the tail -> we never require the tail, only "(Ns").
const WORKING_PATTERNS: RegExp[] = [
  // The live elapsed timer -- the stable anchor across Claude Code versions.
  /\((?:\d+h\s*)?(?:\d+m\s*)?\d+s\b/u,
  // Legacy fallback for OLDER Claude Code that still prints the esc hint.
  /esc to inter/i,
];

// True if `terminalText` (the joined bottom rows of an xterm buffer) contains
// Claude's working indicator, tolerant of wrapping, width truncation, and the
// v2 hint rotation.
export function hasWorkingIndicator(terminalText: string): boolean {
  const t = terminalText.replace(/\s+/g, " ");
  return WORKING_PATTERNS.some((p) => p.test(t));
}

// Patterns that identify Claude Code's IDLE interactive footer (the input
// prompt is showing). Either of these markers confirms Claude is running and
// awaiting input — the caller additionally requires NOT-working before
// auto-submitting.
const READY_PATTERNS: RegExp[] = [/shift\+tab to cycle/i, /\? for shortcuts/i];

// True if `terminalText` contains Claude Code's idle interactive footer,
// meaning Claude is running and waiting for input. Uses the same whitespace-
// collapse as hasWorkingIndicator to tolerate wrapped footers.
export function hasReadyIndicator(terminalText: string): boolean {
  const t = terminalText.replace(/\s+/g, " ");
  return READY_PATTERNS.some((p) => p.test(t));
}
