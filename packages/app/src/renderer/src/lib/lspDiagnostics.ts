import type { Diagnostic } from "@codemirror/lint";
import type { LspDiagnostic } from "../../../shared/ipc";

// Start offset of each line (split on \n).
function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function offsetAt(
  starts: number[],
  textLen: number,
  line: number,
  character: number,
): number {
  if (line < 0) return 0;
  if (line >= starts.length) return textLen;
  return Math.min((starts[line] ?? 0) + Math.max(0, character), textLen);
}

const SEVERITY: Record<number, Diagnostic["severity"]> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "info",
};

// Convert LSP diagnostics (line/character ranges) to CodeMirror diagnostics
// (character offsets), clamped to the document.
export function toCmDiagnostics(
  text: string,
  diags: LspDiagnostic[],
): Diagnostic[] {
  const starts = lineStartsOf(text);
  return diags.map((d) => {
    const from = offsetAt(
      starts,
      text.length,
      d.range.start.line,
      d.range.start.character,
    );
    const to = Math.max(
      from,
      offsetAt(starts, text.length, d.range.end.line, d.range.end.character),
    );
    return {
      from,
      to,
      severity: SEVERITY[d.severity] ?? "info",
      message: d.message,
    };
  });
}
