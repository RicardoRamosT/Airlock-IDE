# Encode-aware redaction (defense-in-depth)

**Date:** 2026-06-05
**Status:** v1 complete.

## Overview
Extend the shared redactor (`agent-core/redact/redactSecrets`) so it also catches
the COMMON ENCODINGS of each secret value -- base64, base64url, hex, base32, and
percent/URL-encoding -- not just the literal value. This closes the base64/hex
exfil path the live gates kept surfacing. Because `run_command` and
`get_terminal_tail` both call `redactSecrets`, the fix upgrades both at once.

## Approach
- **base64 / base64url / hex / base32: decode-and-check.** Scan the output for
  runs of the encoding's alphabet (at/above the shortest possible encoded length
  of any secret), decode each run, and redact it if its bytes CONTAIN a secret
  value. This is robust to alignment, a trailing `echo` newline, and arbitrary
  surrounding bytes -- it does not depend on predicting the exact encoded string,
  and it never leaks partial bytes at group boundaries. base32 (RFC 4648,
  uppercase) is in the same single-shot tier as base64/hex -- a ubiquitous
  `base32` CLI -- and Node has no base32 codec, so it is decoded by hand (5 bits
  per char).
- **Single-layer only:** nested/double-encoding, e.g. base64 of base64, is not
  unwrapped recursively -- that is the unbounded-transform limit. Each run is
  decoded exactly once and checked; the decode-and-check passes do not re-scan
  their own output for a further encoding layer.
- **percent/URL-encoding: forward-encode.** Percent-encoding is byte-local, so
  `encodeURIComponent(value)` is exact -- redact it literally.
- Skip values shorter than 6 chars in the encoded passes (their encodings are
  short + noisy; the literal pass still covers the raw form).

## No over-redaction
A base64/hex/base32 run is redacted ONLY when its decoded bytes actually contain a
secret value -- i.e. the run genuinely encodes the secret. Legitimate base64/hex/
base32 blobs (JWT headers, hashes, SHAs, uppercase identifiers) that do not contain
a secret decode to non-secret bytes and are preserved. The only blobs masked are
ones that really do carry the secret, which is correct.

## Honest limit (unchanged, documented)
This is DEFENSE-IN-DEPTH, not a complete fix. Once a process HOLDS a secret (the
whole point of `run_command` / inject-into-terminal), it can emit it in unbounded
disguises -- reverse it, split it across lines, gzip it, encrypt it, print it
char-by-char, double-encode it (e.g. base64 of base64). No output filter can catch
them all (undecidable in general). This pass closes the easy/common single-shot
encodings (base64/base64url/hex/base32/url); arbitrary transforms and NESTED
encodings (the passes are single-layer -- a run is decoded once, not re-scanned for
a further layer) still slip. The real guarantee remains structural: inject defaults
OFF (the agent's own shell never holds the values), and no tool returns a raw value.

## Security
The redactor is the output protection for both `run_command` and
`get_terminal_tail`. This change only ADDS redaction (more masking, never less),
so it cannot weaken any existing guarantee. It runs after the literal pass and
before the connstring/Bearer defense-in-depth passes.

## Performance
Bounded: the encoded passes run over already-bounded output (the 256KB terminal
tail / the run_command output cap). Only runs at/above the threshold are decoded;
decoding a few hundred KB is sub-millisecond. The min-length threshold avoids
decoding everyday short alphanumeric tokens.

## Out of scope
- A command-risk classifier (flag `| base64`, `| xxd`, `rev`, `gzip` BEFORE the
  command runs) -- a separate, complementary follow-up.
- Catching arbitrary transforms (reverse/split/gzip/custom) and nested/double-
  encoding (the passes are single-layer) -- inherently impossible to catch them
  all; documented as the standing limit.
