import { describe, expect, it } from "vitest";
import { cachingKeychain, type KeychainStore } from "./keychain";

// Fake inner keychain that counts calls (so we can prove the cache collapses
// repeated reads) and can be made to throw a hard platform error (Deny/locked).
function fakeInner(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const calls = { get: 0, set: 0, delete: 0 };
  let throwOnGet: Error | null = null;
  const inner: KeychainStore = {
    get(_service, account) {
      calls.get += 1;
      if (throwOnGet) throw throwOnGet;
      return store.get(account) ?? null;
    },
    set(_service, account, value) {
      calls.set += 1;
      store.set(account, value);
    },
    delete(_service, account) {
      calls.delete += 1;
      return store.delete(account);
    },
  };
  return {
    inner,
    calls,
    setThrow: (e: Error | null) => {
      throwOnGet = e;
    },
  };
}

describe("cachingKeychain", () => {
  it("reads each item from the OS keychain only ONCE per session (the loop fix)", () => {
    const { inner, calls } = fakeInner({ "@global/NEON_API_KEY": "k" });
    const kc = cachingKeychain(inner);
    expect(kc.get("airlock", "@global/NEON_API_KEY")).toBe("k");
    expect(kc.get("airlock", "@global/NEON_API_KEY")).toBe("k");
    expect(kc.get("airlock", "@global/NEON_API_KEY")).toBe("k");
    expect(calls.get).toBe(1); // 3 broker reads -> a single keychain prompt
  });

  it("caches a not-found (null) result too", () => {
    const { inner, calls } = fakeInner();
    const kc = cachingKeychain(inner);
    expect(kc.get("airlock", "MISSING")).toBeNull();
    expect(kc.get("airlock", "MISSING")).toBeNull();
    expect(calls.get).toBe(1);
  });

  it("serves a freshly set value from cache without an OS read", () => {
    const { inner, calls } = fakeInner();
    const kc = cachingKeychain(inner);
    kc.set("airlock", "proj:A", "v1");
    expect(kc.get("airlock", "proj:A")).toBe("v1");
    expect(calls.get).toBe(0);
  });

  it("invalidates the cache on delete", () => {
    const { inner, calls } = fakeInner({ "proj:A": "v" });
    const kc = cachingKeychain(inner);
    expect(kc.get("airlock", "proj:A")).toBe("v");
    kc.delete("airlock", "proj:A");
    expect(kc.get("airlock", "proj:A")).toBeNull(); // re-reads the inner store
    expect(calls.get).toBe(2);
  });

  it("backs off after a hard keychain error: one Deny stops further reads", () => {
    const { inner, calls, setThrow } = fakeInner({ "proj:A": "v" });
    const kc = cachingKeychain(inner);
    setThrow(new Error("User interaction is not allowed / access denied"));
    expect(() => kc.get("airlock", "proj:A")).toThrow(/denied/i); // first read rethrows
    setThrow(null); // even though the keychain would now answer...
    expect(kc.get("airlock", "proj:A")).toBeNull(); // ...we backed off — no prompt
    expect(kc.get("airlock", "proj:B")).toBeNull(); // backoff covers every account
    expect(calls.get).toBe(1); // only the first (throwing) read ever hit the OS
  });

  it("clears the backoff after a successful write (keychain usable again)", () => {
    const { inner, calls, setThrow } = fakeInner();
    const kc = cachingKeychain(inner);
    setThrow(new Error("keychain is locked"));
    expect(() => kc.get("airlock", "proj:A")).toThrow();
    setThrow(null);
    kc.set("airlock", "proj:A", "v"); // a successful write re-enables reads
    expect(kc.get("airlock", "proj:A")).toBe("v"); // from cache populated by set
    expect(kc.get("airlock", "proj:B")).toBeNull(); // reads resume (hits inner)
    expect(calls.get).toBe(2); // the initial throw + the proj:B read
  });
});
