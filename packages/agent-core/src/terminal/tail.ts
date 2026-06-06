// Pure helpers that turn raw PTY output (ANSI escapes + carriage-return
// overwrites) into clean, redacted text for get_terminal_tail. ASCII-only:
// CJS-bundled into the Electron main process (cjs_lexer crashes on multibyte).
import { redactSecrets } from "../redact/redact";

// CSI (ESC [ ... final), OSC (ESC ] ... BEL), and other 2-char ESC sequences.
// The regex source is ASCII; it matches the ESC control byte at runtime.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping real ANSI.
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[@-Z\\-_]/g;

// Strip ANSI escapes; normalize CRLF; collapse bare-CR overwrites per line
// (keep the text after the last CR -- approximates what the terminal displays).
export function cleanTerminalOutput(raw: string): string {
  const noAnsi = raw.replace(ANSI_RE, "");
  const lines = noAnsi.replace(/\r\n/g, "\n").split("\n");
  const collapsed = lines.map((line) => {
    if (line.indexOf("\r") === -1) return line;
    const parts = line.split("\r");
    return parts[parts.length - 1] ?? "";
  });
  return collapsed.join("\n");
}

// The last n lines of (already-cleaned) text. n <= 0 -> "". Drops a single
// trailing empty line so a trailing newline does not waste a slot.
export function lastLines(text: string, n: number): string {
  if (n <= 0) return "";
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-n).join("\n");
}

// The last n NON-empty lines (for the terminal-list preview).
export function previewLines(text: string, n: number): string {
  if (n <= 0) return "";
  const nonEmpty = text.split("\n").filter((l) => l.trim().length > 0);
  return nonEmpty.slice(-n).join("\n");
}

// Clean -> last n lines -> redact every provided value. The security-critical
// composite the tool returns: a secret value present in the buffer is masked.
export function redactedTail(
  raw: string,
  values: string[],
  lines: number,
): string {
  return redactSecrets(lastLines(cleanTerminalOutput(raw), lines), values);
}

// Clean -> last n non-empty lines -> redact: the per-terminal list preview.
export function redactedPreview(
  raw: string,
  values: string[],
  n: number,
): string {
  return redactSecrets(previewLines(cleanTerminalOutput(raw), n), values);
}
