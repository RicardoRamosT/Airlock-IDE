import { describe, expect, it } from "vitest";
import { cachingKeychain, type KeychainStore } from "./keychain";

// Fake inner keychain that counts calls (so we can prove the cache collapses
// repeated reads) and can be made to throw a hard platform error (Deny/locked).
function fakeInner(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const calls = { get: 0, set: 0, delete: 0 };
  let throwOnGet: Error | null = null;
  const inner: KeychainStore = {
    async get(_service, account) {
      calls.get += 1;
      if (throwOnGet) throw throwOnGet;
      return store.get(account) ?? null;
    },
    async set(_service, account, value) {
      calls.set += 1;
      store.set(account, value);
    },
    async delete(_service, account) {
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
  it("reads each item from the OS keychain only ONCE per session (the loop fix)", async () => {
    const { inner, calls } = fakeInner({ "@global/NEON_API_KEY": "k" });
    const kc = cachingKeychain(inner);
    expect(await kc.get("airlock", "@global/NEON_API_KEY")).toBe("k");
    expect(await kc.get("airlock", "@global/NEON_API_KEY")).toBe("k");
    expect(await kc.get("airlock", "@global/NEON_API_KEY")).toBe("k");
    expect(calls.get).toBe(1); // 3 broker reads -> a single keychain prompt
  });

  it("dedupes CONCURRENT reads of the same item into one OS call", async () => {
    // Reads are async now, so two callers that arrive together would both miss
    // a value-only cache and both reach the OS -- two modal prompts for one
    // secret, which is the storm this cache exists to prevent. The cache holds
    // the in-flight promise.
    const { inner, calls } = fakeInner({ "proj:A": "v" });
    const kc = cachingKeychain(inner);
    const [a, b, c] = await Promise.all([
      kc.get("airlock", "proj:A"),
      kc.get("airlock", "proj:A"),
      kc.get("airlock", "proj:A"),
    ]);
    expect([a, b, c]).toEqual(["v", "v", "v"]);
    expect(calls.get).toBe(1);
  });

  it("caches a not-found (null) result too", async () => {
    const { inner, calls } = fakeInner();
    const kc = cachingKeychain(inner);
    expect(await kc.get("airlock", "MISSING")).toBeNull();
    expect(await kc.get("airlock", "MISSING")).toBeNull();
    expect(calls.get).toBe(1);
  });

  it("serves a freshly set value from cache without an OS read", async () => {
    const { inner, calls } = fakeInner();
    const kc = cachingKeychain(inner);
    await kc.set("airlock", "proj:A", "v1");
    expect(await kc.get("airlock", "proj:A")).toBe("v1");
    expect(calls.get).toBe(0);
  });

  it("invalidates the cache on delete", async () => {
    const { inner, calls } = fakeInner({ "proj:A": "v" });
    const kc = cachingKeychain(inner);
    expect(await kc.get("airlock", "proj:A")).toBe("v");
    await kc.delete("airlock", "proj:A");
    expect(await kc.get("airlock", "proj:A")).toBeNull(); // re-reads the inner store
    expect(calls.get).toBe(2);
  });

  it("backs off after a hard keychain error: one Deny stops further reads", async () => {
    const { inner, calls, setThrow } = fakeInner({ "proj:A": "v" });
    const kc = cachingKeychain(inner);
    setThrow(new Error("User interaction is not allowed / access denied"));
    await expect(kc.get("airlock", "proj:A")).rejects.toThrow(/denied/i);
    setThrow(null); // even though the keychain would now answer...
    // ...we stay backed off -- but we SAY so rather than answering "null",
    // which a caller cannot tell from "no such entry". Returning null here let
    // setSecret overwrite a project's whole vault with a single key.
    await expect(kc.get("airlock", "proj:A")).rejects.toThrow(/unavailable/i);
    await expect(kc.get("airlock", "proj:B")).rejects.toThrow(/unavailable/i);
    expect(calls.get).toBe(1); // only the first (throwing) read ever hit the OS
  });

  it("clears the backoff after a successful write (keychain usable again)", async () => {
    const { inner, calls, setThrow } = fakeInner();
    const kc = cachingKeychain(inner);
    setThrow(new Error("keychain is locked"));
    await expect(kc.get("airlock", "proj:A")).rejects.toThrow();
    await expect(kc.get("airlock", "proj:A")).rejects.toThrow(/unavailable/i);
    setThrow(null);
    await kc.set("airlock", "proj:A", "v"); // a successful write re-enables reads
    expect(await kc.get("airlock", "proj:A")).toBe("v"); // from cache set by set()
    expect(await kc.get("airlock", "proj:B")).toBeNull(); // reads resume
    expect(calls.get).toBe(2); // the initial throw + the proj:B read
  });
});
