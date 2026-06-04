/**
 * Minimal .env parser for import-to-keychain. Supports comments, export
 * prefix, single/double quotes, and backslash-escape unescaping inside
 * double quotes (\n, \r, \t, \", \\). Deliberately NOT a full dotenv
 * implementation (no multiline quoted blocks spanning physical lines) -
 * good enough for real .env files, and anything it cannot parse is simply
 * skipped, never corrupted.
 */

// Single-pass unescape for double-quoted values. One regex consumes a
// backslash plus the following char, so "\\n" (backslash, backslash, n) is
// matched as the "\\" escape -> a literal backslash, leaving "n" untouched
// (result: backslash + n, two chars), while "\n" (backslash, n) maps to a
// real newline. An unknown escape keeps the backslash literally.
const DQ_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  '"': '"',
  "\\": "\\",
};
function unescapeDoubleQuoted(val: string): string {
  return val.replace(/\\(.)/g, (_, c: string) => DQ_ESCAPES[c] ?? `\\${c}`);
}
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (!key) continue;
    let val = m[2] ?? "";
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = unescapeDoubleQuoted(val.slice(1, -1));
    } else if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(" #");
      if (hash !== -1) val = val.slice(0, hash);
      val = val.trim();
    }
    out[key] = val;
  }
  return out;
}
