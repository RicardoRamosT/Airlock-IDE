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
const WORKING_INDICATOR = /esc to inter/i;

// True if `terminalText` (the joined bottom rows of an xterm buffer) contains
// Claude's working indicator, tolerant of wrapping and width truncation.
export function hasWorkingIndicator(terminalText: string): boolean {
  return WORKING_INDICATOR.test(terminalText.replace(/\s+/g, " "));
}
