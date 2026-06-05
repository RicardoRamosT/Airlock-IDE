// ASCII-only by design: this file is CJS-bundled into Electron main and
// Electron's cjs_lexer crashes on multibyte chars, so no smart punctuation in
// any regex, string literal, or comment in this file.
import { redactConnStrings } from "../db/connstr";

const PLACEHOLDER = "***";

// Secret values are DATA, not patterns: a password full of regex metacharacters
// must match literally, so escape every special char before building a RegExp.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Redact secret VALUES from text before it can reach the agent. Exact-match
// every non-empty value (all occurrences) -> ***, longest-first so a value that
// contains a shorter one is fully masked. Then a defense-in-depth pattern pass
// for secret-shaped strings that were NOT in the injected set. Over-redaction is
// safe; under-redaction leaks. Empty/whitespace-only values are skipped so we
// never mask the whole output.
export function redactSecrets(text: string, values: string[]): string {
  let out = text;
  const vals = [...new Set(values)]
    .filter((v) => typeof v === "string" && v.trim().length > 0)
    .sort((a, b) => b.length - a.length);
  for (const v of vals) {
    out = out.replace(new RegExp(escapeRegExp(v), "g"), PLACEHOLDER);
  }
  out = redactConnStrings(out);
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${PLACEHOLDER}`);
  return out;
}
