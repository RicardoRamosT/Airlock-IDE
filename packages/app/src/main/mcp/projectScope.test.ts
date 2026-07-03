import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// projectScope keeps a module singleton; reset between tests via a test-only hook
// OR test the pure pair via an exported factory. If the module exposes a factory
// makeRegistry(installSalt), prefer that; otherwise test rootForToken after a
// manual register. Using real tmp dirs because projectIdFor calls realpath.
import { makeScopeRegistry } from "./projectScope";

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "airlock-scope-test-"));
}

describe("makeScopeRegistry", () => {
  it("maps token<->root deterministically", async () => {
    const proj = await makeTmpDir();
    const reg = makeScopeRegistry({ installSalt: "salt" });
    const t = await reg.tokenForRoot(proj); // registers
    expect(reg.rootForToken(t)).toBe(proj);
    expect(reg.rootForToken("nope")).toBeNull();
    expect(reg.rootForToken(null)).toBeNull();
  });

  it("returns same token for the same root", async () => {
    const proj = await makeTmpDir();
    const reg = makeScopeRegistry({ installSalt: "salt" });
    const t1 = await reg.tokenForRoot(proj);
    const t2 = await reg.tokenForRoot(proj);
    expect(t1).toBe(t2);
  });

  it("returns different tokens for different roots with same salt", async () => {
    const projA = await makeTmpDir();
    const projB = await makeTmpDir();
    const reg = makeScopeRegistry({ installSalt: "salt" });
    const t1 = await reg.tokenForRoot(projA);
    const t2 = await reg.tokenForRoot(projB);
    expect(t1).not.toBe(t2);
  });

  it("different salts produce different tokens for same root", async () => {
    const proj = await makeTmpDir();
    const reg1 = makeScopeRegistry({ installSalt: "salt1" });
    const reg2 = makeScopeRegistry({ installSalt: "salt2" });
    const t1 = await reg1.tokenForRoot(proj);
    const t2 = await reg2.tokenForRoot(proj);
    expect(t1).not.toBe(t2);
  });

  it("token is 32-hex characters", async () => {
    const proj = await makeTmpDir();
    const reg = makeScopeRegistry({ installSalt: "anysalt" });
    const t = await reg.tokenForRoot(proj);
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });
});
