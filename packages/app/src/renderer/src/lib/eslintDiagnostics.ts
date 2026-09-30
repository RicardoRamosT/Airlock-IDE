// eslintDiagnostics.ts -- ESLint's messages as CodeMirror diagnostics, and the
// per-source merge that lets them sit beside TypeScript's.
//
// Why the merge exists: CodeMirror's setDiagnostics REPLACES every diagnostic
// in the view. Two sources each dispatching their own list would erase each
// other on every update, so the editor keeps the latest list per source and
// always dispatches the union.
import type { Diagnostic } from "@codemirror/lint";
import type { EslintLintMessage } from "../../../shared/ipc";
import { lineStartsOf, offsetAt } from "./lspDiagnostics";

export type DiagSource = "typescript" | "eslint";
export type EslintFixEdit = NonNullable<EslintLintMessage["fix"]>;

// ESLint positions are 1-based (line and column) with an exclusive end; the
// shared offset helper is 0-based like LSP, hence the -1s.
export function eslintToCm(
  text: string,
  msgs: EslintLintMessage[],
  onFix: (fix: EslintFixEdit) => void,
): Diagnostic[] {
  const starts = lineStartsOf(text);
  const at = (line: number, col: number) =>
    offsetAt(starts, text.length, line - 1, col - 1);
  return msgs.map((m) => {
    const from = at(m.line, m.column);
    const to =
      m.endLine !== undefined && m.endColumn !== undefined
        ? Math.max(from, at(m.endLine, m.endColumn))
        : Math.min(from + 1, text.length); // no end: mark one character
    const fix = m.fix;
    return {
      from,
      to,
      severity: m.severity === 2 ? "error" : "warning",
      message: m.message,
      source: m.ruleId ? `eslint(${m.ruleId})` : "eslint",
      ...(fix ? { actions: [{ name: "Fix", apply: () => onFix(fix) }] } : {}),
    };
  });
}

export function mergeBySource(
  bySource: Partial<Record<DiagSource, Diagnostic[]>>,
): Diagnostic[] {
  return [...(bySource.typescript ?? []), ...(bySource.eslint ?? [])];
}

// A result is painted only for the exact text it was computed from; anything
// older arrived after further typing and would land on shifted offsets.
export function acceptResult(current: number, resultVersion: number): boolean {
  return current === resultVersion;
}
