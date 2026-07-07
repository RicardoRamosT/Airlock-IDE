// packages/agent-core/src/oauth/state.ts
// A random, URL-safe OAuth `state`: the CSRF/interception guard that ties an
// authorize redirect back to the request that opened it, and lets the app match
// the airlock:// callback to a pending flow. The raw token never rides the
// callback URL (only a one-time ticket + this state do). RNG is injectable so
// tests are deterministic.
import { randomBytes } from "node:crypto";

// Default randomness: node's CSPRNG. DI'd so tests can pin the bytes.
function defaultRng(n: number): Uint8Array {
  return randomBytes(n);
}

// base64url of `bytes` random bytes (24 => 32 chars, no padding).
export function randomState(
  rng: (n: number) => Uint8Array = defaultRng,
  bytes = 24,
): string {
  return Buffer.from(rng(bytes)).toString("base64url");
}
