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

// Decode a base64 run to bytes (standard or url-safe); null if it yields nothing.
// Buffer.from(.,"base64") is lenient -- a non-base64 run just yields junk bytes
// that will not contain a secret, so a bad guess is harmless.
function decodeBase64(run: string, urlSafe: boolean): Buffer | null {
  const norm = urlSafe ? run.replace(/-/g, "+").replace(/_/g, "/") : run;
  const buf = Buffer.from(norm, "base64");
  return buf.length > 0 ? buf : null;
}

// RFC 4648 base32 alphabet (uppercase). Node's Buffer has no base32, so decode
// by hand: 5 bits per char, emit a byte whenever >= 8 bits are buffered. The
// buffer is masked to the pending bits each step so it never overflows 32-bit.
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decodeBase32(run: string): Buffer | null {
  const clean = run.replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) return null;
  let buffer = 0;
  let bitsLeft = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) return null; // not valid base32
    buffer = (buffer << 5) | idx;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      out.push((buffer >> bitsLeft) & 0xff);
      buffer &= (1 << bitsLeft) - 1;
    }
  }
  return out.length > 0 ? Buffer.from(out) : null;
}

function containsAny(buf: Buffer, valueBufs: Buffer[]): boolean {
  for (const vb of valueBufs) {
    if (buf.includes(vb)) return true;
  }
  return false;
}

// Encode-aware pass (defense-in-depth): a command that HAS a secret can print an
// ENCODED form that exact-match redaction misses. We know each secret's value, so
// we catch its common encodings -- base64/base64url/hex/base32 via decode-and-check
// (robust to alignment + trailing newlines), and percent-encoding via forward
// match. This is SINGLE-LAYER only: a run is decoded once and checked; nested or
// double-encoding (e.g. base64 of base64) is not unwrapped recursively. It also
// does NOT catch arbitrary transforms (reverse/split/gzip/custom) -- once a
// process holds a value it can emit it in unbounded disguises that no output
// filter can fully catch. Only masks a run that DECODES to bytes containing a
// secret, so innocent blobs are preserved.
function redactEncoded(text: string, vals: string[]): string {
  // 4-char floor: shorter values base64/hex to runs too short to tell apart from
  // ordinary tokens, and the literal pass already masks them verbatim. Run-length
  // floors below are derived from the shortest kept value so its encoded form
  // (which can be only a few chars) still matches; decode-and-check -- not these
  // floors -- is what prevents over-redacting innocent blobs.
  const use = vals.filter((v) => v.length >= 4);
  if (use.length === 0) return text;
  const valueBufs = use.map((v) => Buffer.from(v, "utf8"));
  const minBytes = Math.min(...use.map((v) => Buffer.byteLength(v, "utf8")));
  let out = text;

  // base64 + base64url: one scan over the superset alphabet, try both decodings.
  // ceil(4*minBytes/3) - 1 lower-bounds the alphabet chars an unpadded encoding
  // of the shortest value can have (a safe lower bound on the encoded length),
  // floored at 4.
  const b64min = Math.max(4, Math.ceil((4 * minBytes) / 3) - 1);
  out = out.replace(
    new RegExp(`[A-Za-z0-9+/_-]{${b64min},}={0,2}`, "g"),
    (run) => {
      const std = decodeBase64(run, false);
      if (std && containsAny(std, valueBufs)) return PLACEHOLDER;
      const url = decodeBase64(run, true);
      if (url && containsAny(url, valueBufs)) return PLACEHOLDER;
      return run;
    },
  );

  // hex: even-length runs, decode, redact if they carry a secret.
  const hexmin = Math.max(8, 2 * (minBytes - 1));
  out = out.replace(new RegExp(`[0-9a-fA-F]{${hexmin},}`, "g"), (run) => {
    const even = run.length % 2 === 0 ? run : run.slice(0, -1);
    const buf = Buffer.from(even, "hex");
    return buf.length > 0 && containsAny(buf, valueBufs) ? PLACEHOLDER : run;
  });

  // base32 (RFC 4648): runs of [A-Za-z2-7] -- matched CASE-INSENSITIVELY, since a
  // lowercase form (e.g. `base32 | tr A-Z a-z`) would otherwise bypass the scan
  // (audit H6); decodeBase32 uppercases the run internally. Decode, redact if it
  // carries a secret. Same tier as base64 (ubiquitous `base32` CLI).
  const b32min = Math.max(8, Math.ceil((minBytes * 8) / 5));
  out = out.replace(new RegExp(`[A-Za-z2-7]{${b32min},}={0,6}`, "g"), (run) => {
    const buf = decodeBase32(run);
    return buf && containsAny(buf, valueBufs) ? PLACEHOLDER : run;
  });

  // percent / URL-encoding: byte-local, so forward-encode + exact-match.
  for (const v of use) {
    const enc = encodeURIComponent(v);
    if (enc !== v) {
      out = out.replace(new RegExp(escapeRegExp(enc), "g"), PLACEHOLDER);
    }
  }
  return out;
}

// Redact secret VALUES from text before it can reach the agent. Exact-match
// every non-empty value (all occurrences) -> ***, longest-first so a value that
// contains a shorter one is fully masked. Then an encode-aware pass (base64/hex/
// url forms of each value), then a defense-in-depth pattern pass for
// secret-shaped strings. Over-redaction is safe; under-redaction leaks.
// Empty/whitespace-only values are skipped so we never mask the whole output.
export function redactSecrets(text: string, values: string[]): string {
  let out = text;
  const vals = [...new Set(values)]
    .filter((v) => typeof v === "string" && v.trim().length > 0)
    .sort((a, b) => b.length - a.length);
  for (const v of vals) {
    out = out.replace(new RegExp(escapeRegExp(v), "g"), PLACEHOLDER);
  }
  out = redactEncoded(out, vals);
  out = redactConnStrings(out);
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${PLACEHOLDER}`);
  return out;
}
