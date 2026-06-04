import { Entry } from "@napi-rs/keyring";

/**
 * Indirection over the OS keychain so the broker is testable with an
 * in-memory fake. The system implementation talks to the macOS Keychain.
 */
export interface KeychainStore {
  set(service: string, account: string, value: string): void;
  get(service: string, account: string): string | null;
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
