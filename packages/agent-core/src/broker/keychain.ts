import { Entry } from "@napi-rs/keyring";

/**
 * Indirection over the OS keychain so the broker is testable with an
 * in-memory fake. The system implementation talks to the macOS Keychain.
 * Note: get() returns null for both not-found and platform errors (locked
 * keychain, access denied) - callers cannot distinguish; inject surfaces
 * these as "missing". set() propagates write failures as thrown errors.
 */
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
      return new Entry(service, account).getPassword();
    } catch {
      return null;
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
