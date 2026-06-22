// Detects Claude Code's "working" state from its own on-screen footer. While
// Claude processes a turn it shows an "esc to interrupt" status line near the
// bottom of the terminal; the per-tab status dot is driven off this (see
// TerminalPane's buffer scan).
//
// Two width effects make an exact "esc to interrupt" match unreliable, and BOTH
// are handled here so the matcher has one home:
//   1. WRAP: in a tall-but-narrow terminal the footer can wrap across lines
//      ("esc to\ninterrupt"). The caller joins buffer rows, and we collapse all
//      whitespace before matching so a wrapped footer still matches.
//   2. TRUNCATION: in a NARROW pane (notably a split) Claude abbreviates the
//      footer to fit the width, so the buffer holds "esc to interru..." (with a
//      trailing ellipsis) rather than the full phrase. Matching the full word
//      "interrupt" then fails and the dot stays gray in split panes.
//
// So we match the truncation-resistant prefix "esc to inter": distinctive to
// the working footer (idle hints like "esc to clear" do not contain it) yet
// intact for the truncations seen in real split widths.
//
//   3. ROTATION (Claude Code v2.1.x): the status line cycles its hint segment
//      ("esc to interrupt" <-> "N tokens" <-> "thinking with xhigh effort"),
//      so the esc hint is ABSENT for long stretches while Claude is plainly
//      working ("✦ Sautéing… (7s · thinking with xhigh effort)").
//   4. SPINNER FRAMES (v2.1.185): the leading spinner glyph rotates through a
//      set that keeps changing across releases (braille "⠂", "✦", "+", … — well
//      beyond any fixed class), so anchoring on the glyph is a losing game and
//      silently broke the dot. Match the glyph-INDEPENDENT core every rotation
//      keeps: the gerund verb, "…", then "(" + the elapsed-SECONDS counter
//      ("(7s", "(83s"). Finished summaries ("✳ Churned for 6s") and idle hints
//      ("(shift+tab to cycle)") lack that "…(<N>s" core, so they stay unlit.
const WORKING_PATTERNS: RegExp[] = [/esc to inter/i, /\S+…\s*\(\d+s/u];

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
