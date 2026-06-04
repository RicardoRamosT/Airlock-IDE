import { Entry } from "@napi-rs/keyring";

/**
 * Indirection over the OS keychain so the broker is testable with an
 * in-memory fake. The system implementation talks to the macOS Keychain.
 * Note: get() returns null for a genuine not-found entry but RETHROWS real
 * platform errors (locked keychain, access denied, ambiguous credential) so
 * inject can surface them distinctly instead of masking them as "missing".
 * set() propagates write failures as thrown errors.
 */

/**
 * Matches the not-found message from @napi-rs/keyring (keyring-rs NoEntry).
 * The native message in this binary is "No matching credential found"; older
 * phrasings ("No matching entry found...", "no entry found", "...not found")
 * are covered too. Anything else (locked, access-denied, ambiguous, bad
 * encoding) deliberately does NOT match, so it propagates as a real error.
 */
const NOT_FOUND_RE =
  /\bno (matching |such )?(entry|credential|password|item)\b|not found/i;
export interface KeychainStore {
  set(service: string, account: string, value: string): void;
  get(service: string, account: string): string | null;
  /**
   * Returns false on both not-found and platform failure; deleteSecret
   * proceeds either way, so a silently failed OS delete leaves the value
   * in the keychain while meta and audit say deleted (known v1 limitation).
   */
  delete(service: string, account: string): boolean;
}

export const systemKeychain: KeychainStore = {
  set(service, account, value) {
    new Entry(service, account).setPassword(value);
  },
  get(service, account) {
    try {
      // The sync API returns null for a missing entry; a throw here is a real
      // platform error. Classify by message: not-found -> null (missing);
      // anything else (locked/access-denied/ambiguous) rethrows so the caller
      // can distinguish a locked keychain from a genuinely absent secret.
      return new Entry(service, account).getPassword();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (NOT_FOUND_RE.test(msg)) return null;
      throw err;
    }
  },
  delete(service, account) {
    try {
      return new Entry(service, account).deleteCredential();
    } catch {
      return false;
    }
  },
};
