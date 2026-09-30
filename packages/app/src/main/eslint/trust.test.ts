import { describe, expect, it } from "vitest";
import { type TrustFs, TrustStore } from "./trust";

// In-memory fs. `links` maps a path to its realpath; anything under /gone does
// not exist (realpath -> null), like a renamed or deleted folder.
function memFs(
  links: Record<string, string> = {},
): TrustFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (f) => files.get(f) ?? null,
    write: (f, d) => void files.set(f, d),
    realpath: (p) => links[p] ?? (p.startsWith("/gone") ? null : p),
  };
}

describe("TrustStore", () => {
  it("starts untrusted and remembers a grant across instances", () => {
    const fs = memFs();
    const a = new TrustStore("/ud/eslint-trust.json", fs);
    expect(a.isTrusted("/p/app")).toBe(false);
    a.set("/p/app", true);
    expect(
      new TrustStore("/ud/eslint-trust.json", fs).isTrusted("/p/app"),
    ).toBe(true);
  });

  it("revokes", () => {
    const s = new TrustStore("/t", memFs());
    s.set("/p/app", true);
    s.set("/p/app", false);
    expect(s.isTrusted("/p/app")).toBe(false);
  });

  it("keys by REALPATH: a symlink cannot borrow another folder's grant", () => {
    const s = new TrustStore("/t", memFs({ "/p/link": "/p/evil" }));
    s.set("/p/app", true);
    expect(s.isTrusted("/p/link")).toBe(false);
    s.set("/p/link", true); // trusting via the link trusts the TARGET
    expect(s.isTrusted("/p/evil")).toBe(true);
  });

  it("a renamed/removed folder is untrusted, never trusted by a stale path", () => {
    const fs = memFs();
    const s = new TrustStore("/t", fs);
    s.set("/p/app", true);
    // The folder moves away: the old path now resolves to nothing.
    const moved = new TrustStore("/t", { ...fs, realpath: () => null });
    expect(moved.isTrusted("/p/app")).toBe(false);
    expect(() => s.set("/gone/app", true)).toThrow();
  });

  it("a corrupt store trusts nothing (fails closed)", () => {
    const fs = memFs();
    fs.write("/t", "{not json");
    expect(new TrustStore("/t", fs).isTrusted("/p/app")).toBe(false);
  });

  it("ignores non-string entries in a hand-edited store", () => {
    const fs = memFs();
    fs.write(
      "/t",
      JSON.stringify({ version: 1, trusted: [42, "/p/app", null] }),
    );
    expect(new TrustStore("/t", fs).isTrusted("/p/app")).toBe(true);
  });
});
