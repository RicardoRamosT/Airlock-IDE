# Encode-aware redaction (defense-in-depth)

**Date:** 2026-06-05
**Status:** v1 complete.

## Overview
Extend the shared redactor (`agent-core/redact/redactSecrets`) so it also catches
the COMMON ENCODINGS of each secret value -- base64, base64url, hex, and
percent/URL-encoding -- not just the literal value. This closes the base64/hex
exfil path the live gates kept surfacing. Because `run_command` and
`get_terminal_tail` both call `redactSecrets`, the fix upgrades both at once.

## Approach
- **base64 / base64url / hex: decode-and-check.** Scan the output for runs of the
  encoding's alphabet (at/above the shortest possible encoded length of any
  secret), decode each run, and redact it if its bytes CONTAIN a secret value.
  This is robust to alignment, a trailing `echo` newline, and arbitrary
  surrounding bytes -- it does not depend on predicting the exact encoded string,
  and it never leaks partial bytes at group boundaries.
- **percent/URL-encoding: forward-encode.** Percent-encoding is byte-local, so
  `encodeURIComponent(value)` is exact -- redact it literally.
- Skip values shorter than 6 chars in the encoded passes (their encodings are
  short + noisy; the literal pass still covers the raw form).

## No over-redaction
A base64/hex run is redacted ONLY when its decoded bytes actually contain a secret
value -- i.e. the run genuinely encodes the secret. Legitimate base64/hex blobs
(JWT headers, hashes, SHAs) that do not contain a secret decode to non-secret
bytes and are preserved. The only blobs masked are ones that really do carry the
secret, which is correct.

## Honest limit (unchanged, documented)
This is DEFENSE-IN-DEPTH, not a complete fix. Once a process HOLDS a secret (the
whole point of `run_command` / inject-into-terminal), it can emit it in unbounded
disguises -- reverse it, split it, gzip it, encrypt it, print it char-by-char,
double-encode it. No output filter can catch them all (undecidable in general).
This pass closes the easy/common encodings (base64/hex/url); arbitrary transforms
still slip. The real guarantee remains structural: inject defaults OFF (the
agent's own shell never holds the values), and no tool ever returns a raw value.

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
- Catching arbitrary transforms (reverse/split/gzip/custom/double-encode) --
  inherently impossible; documented as the standing limit.
