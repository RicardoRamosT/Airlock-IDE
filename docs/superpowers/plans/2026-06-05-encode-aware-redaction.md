# Encode-aware Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `redactSecrets` also catch base64 / base64url / hex / percent-encoded forms of each secret value (decode-and-check), closing the encoding-exfil path for both `run_command` and `get_terminal_tail`.

**Architecture:** One change to the shared redactor (`agent-core/redact/redact.ts`): a `redactEncoded` pass that decodes base64/hex runs and masks any whose bytes contain a secret, plus forward-redacts the percent-encoded form. Heavily TDD'd. No other modules change (both tools call `redactSecrets`).

**Tech Stack:** TypeScript (strict, noUncheckedIndexedAccess), Node `Buffer`, vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-05-encode-aware-redaction-design.md`

**Constraints:** ASCII-only (this file is CJS-bundled into Electron main). Over-redaction is safe; under-redaction leaks -- but redact a base64/hex run ONLY when it decodes to bytes containing a secret (no blanket masking of blobs).

---

## Task 1: encode-aware redactor + tests

**Files:**
- Modify: `packages/agent-core/src/redact/redact.ts`
- Modify: `packages/agent-core/src/redact/redact.test.ts`

- [ ] **Step 1: Write the failing tests** (append to redact.test.ts; match its existing import of `redactSecrets`):
```ts
describe("redactSecrets - encoded forms", () => {
  const SECRET = "testtesttest"; // 12 chars, a realistic vaulted value

  it("redacts base64 of the value (printf-style, exact)", () => {
    const b64 = Buffer.from(SECRET).toString("base64");
    const out = redactSecrets(`token=${b64}`, [SECRET]);
    expect(out).not.toContain(b64);
    expect(out).not.toContain(SECRET);
    expect(out).toContain("***");
  });

  it("redacts base64 of the value with a trailing newline (echo | base64)", () => {
    const b64 = Buffer.from(`${SECRET}\n`).toString("base64");
    const out = redactSecrets(`LEAKTEST=${b64}`, [SECRET]);
    expect(out).not.toContain(b64);
    expect(out).toContain("***");
  });

  it("redacts base64 for a non-3-aligned value length", () => {
    const v = "abcd"; // len 4, not a multiple of 3
    const b64 = Buffer.from(`${v}\n`).toString("base64");
    const out = redactSecrets(`x ${b64} y`, [v]);
    expect(out).not.toContain(b64);
    expect(out).toContain("***");
  });

  it("redacts base64url of the value", () => {
    const b64url = Buffer.from(SECRET)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const out = redactSecrets(`h=${b64url}`, [SECRET]);
    expect(out).not.toContain(b64url);
    expect(out).toContain("***");
  });

  it("redacts hex of the value (xxd-style, with/without trailing newline)", () => {
    const hex = Buffer.from(SECRET).toString("hex");
    const hexNl = Buffer.from(`${SECRET}\n`).toString("hex");
    expect(redactSecrets(`v=${hex}`, [SECRET])).not.toContain(hex);
    expect(redactSecrets(`v=${hexNl}`, [SECRET])).not.toContain(SECRET);
    expect(redactSecrets(`v=${hex}`, [SECRET])).toContain("***");
  });

  it("redacts the percent-encoded form", () => {
    const v = "p@ss/w&rd=1!"; // has chars that percent-encode
    const enc = encodeURIComponent(v);
    const out = redactSecrets(`url?x=${enc}`, [v]);
    expect(out).not.toContain(enc);
    expect(out).toContain("***");
  });

  it("does NOT over-redact a base64 blob that lacks the secret", () => {
    const innocent = Buffer.from("hello world, nothing secret here").toString("base64");
    const out = redactSecrets(`data=${innocent}`, [SECRET]);
    expect(out).toContain(innocent); // preserved
  });

  it("does NOT over-redact a hex hash that lacks the secret", () => {
    const sha = "a".repeat(40); // 40-char hex, decodes to non-secret bytes
    const out = redactSecrets(`sha=${sha}`, [SECRET]);
    expect(out).toContain(sha);
  });

  it("still redacts the literal value (existing behavior intact)", () => {
    expect(redactSecrets(`raw ${SECRET} here`, [SECRET])).toBe("raw *** here");
  });

  it("no values -> text unchanged by the encoded pass", () => {
    const b64 = Buffer.from(SECRET).toString("base64");
    expect(redactSecrets(`x ${b64}`, [])).toBe(`x ${b64}`);
  });
});
```
Run: `cd /Users/ricardoramos/Projects/airlock && npx vitest run packages/agent-core/src/redact/redact.test.ts` -> the new cases FAIL (encoded forms not yet redacted), the existing ones PASS.

- [ ] **Step 2: Implement `redactEncoded` + wire it into `redactSecrets`** (redact.ts, ASCII-only). Replace the file body with:
```ts
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

function containsAny(buf: Buffer, valueBufs: Buffer[]): boolean {
  for (const vb of valueBufs) {
    if (buf.includes(vb)) return true;
  }
  return false;
}

// Encode-aware pass (defense-in-depth): a command that HAS a secret can print an
// ENCODED form that exact-match redaction misses. We know each secret's value, so
// we catch its common encodings -- base64/base64url/hex via decode-and-check
// (robust to alignment + trailing newlines), and percent-encoding via forward
// match. This does NOT catch arbitrary transforms (reverse/split/gzip/custom) --
// once a process holds a value it can emit it in unbounded disguises that no
// output filter can fully catch. Only masks a run that DECODES to bytes
// containing a secret, so innocent blobs are preserved.
function redactEncoded(text: string, vals: string[]): string {
  const use = vals.filter((v) => v.length >= 6);
  if (use.length === 0) return text;
  const valueBufs = use.map((v) => Buffer.from(v, "utf8"));
  const minBytes = Math.min(...use.map((v) => Buffer.byteLength(v, "utf8")));
  let out = text;

  // base64 + base64url: one scan over the superset alphabet, try both decodings.
  const b64min = Math.max(8, Math.ceil((4 * minBytes) / 3));
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
  const hexmin = Math.max(8, 2 * minBytes);
  out = out.replace(new RegExp(`[0-9a-fA-F]{${hexmin},}`, "g"), (run) => {
    const even = run.length % 2 === 0 ? run : run.slice(0, -1);
    const buf = Buffer.from(even, "hex");
    return buf.length > 0 && containsAny(buf, valueBufs) ? PLACEHOLDER : run;
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
```

- [ ] **Step 3: Run -> all pass**

Run: `cd /Users/ricardoramos/Projects/airlock && npx vitest run packages/agent-core/src/redact/redact.test.ts` -> all PASS (new + existing). If biome flags the control-free regexes (these have no control chars, so it should not), fix per biome.

- [ ] **Step 4: Typecheck + full tests + lint + commit**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npm test && npm run lint`
Expected: clean + all green (run_command's redaction test + get_terminal_tail's redactedTail test still pass -- they inherit the stronger redactor). Record the test count.
```bash
git add packages/agent-core/src/redact/redact.ts packages/agent-core/src/redact/redact.test.ts
git commit -m "feat(redact): encode-aware redaction (base64/base64url/hex/percent) via decode-and-check"
```

---

## Task 2: docs (honest limits) + verify + repackage

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-encode-aware-redaction-design.md` (status -> v1 complete)
- Modify: the "honest limits" claims in the docs that currently say literal/exact-match redaction misses base64/encoded values.

- [ ] **Step 1: Update the limit claims.** Grep the repo for the places that describe the redaction limit and update them to: base64 / base64url / hex / percent-encoding ARE now redacted (encode-aware); arbitrary transforms (reverse, split, gzip, custom, double-encode) still slip -- inherent once a process holds the value. Check at least:
  - `packages/app/resources/mcp-docs/security-model.md` (run_command + terminal sections)
  - `packages/app/resources/mcp-docs/tools.md` (run_command + get_terminal_tail descriptions)
  - `docs/superpowers/specs/2026-06-05-run-command-design.md` (the INHERENT v1 LIMIT note)
  - `docs/superpowers/specs/2026-06-05-terminal-tail-design.md` (the LITERAL REDACTION limit note)
  Run `grep -rn -i "base64\|exact-match\|literal redaction\|encod" packages/app/resources/mcp-docs docs/superpowers/specs` to find every spot; update each to the new accurate wording (keep it honest -- still not a guarantee vs a determined agent).

- [ ] **Step 2: spec status** -> `**Status:** v1 complete.`

- [ ] **Step 3: README** -- if it mentions the redaction limit, update it; else skip.

- [ ] **Step 4: Full verification**
Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npm test && npm run lint && npm run build`
All green; record the test count.

- [ ] **Step 5: Repackage**
Run: `cd /Users/ricardoramos/Projects/airlock && npm run package`
Fresh `.app` builds (the "skipped code signing / identity null" notice is expected). Note the timestamp.

- [ ] **Step 6: Commit**
```bash
git add docs/ packages/app/resources/mcp-docs/ README.md
git commit -m "docs(redact): base64/hex/url now caught; arbitrary transforms remain the documented limit; repackage"
```

---

## Self-review notes
- Only ADDS redaction -- cannot weaken any guarantee; runs after literal, before connstr/Bearer.
- decode-and-check is alignment/newline robust + no partial-byte leak; masks only runs that decode to contain a secret (no over-redaction of innocent blobs -- tested).
- Both run_command + get_terminal_tail inherit it (shared redactor; their existing redaction tests still pass).
- Honest limit kept accurate: base64/hex/url closed; arbitrary transforms still slip.
- ASCII-only; bounded perf (over already-bounded output).
