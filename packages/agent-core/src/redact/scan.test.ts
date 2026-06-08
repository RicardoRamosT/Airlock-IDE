import { describe, expect, it } from "vitest";
import { scanForSecrets } from "./scan";

describe("scanForSecrets", () => {
  it("finds a vaulted value literally and names it (1-indexed line)", () => {
    const text = "const a = 1;\nconst k = \"supersecretvalue\";\n";
    const f = scanForSecrets(text, [{ name: "API_KEY", value: "supersecretvalue" }]);
    expect(f).toEqual([{ line: 2, kind: "vaulted", name: "API_KEY" }]);
  });

  it("ignores vaulted values shorter than 4 chars", () => {
    const f = scanForSecrets("x = abc", [{ name: "S", value: "abc" }]);
    expect(f).toEqual([]);
  });

  it("flags known patterns by type, even when not vaulted", () => {
    const text = "key = \"sk_live_abcdefghijklmnop12345\"\n";
    const f = scanForSecrets(text, []);
    expect(f).toEqual([{ line: 1, kind: "pattern", patternType: "stripe-secret" }]);
  });

  it("flags a PEM private key header", () => {
    const f = scanForSecrets("-----BEGIN RSA PRIVATE KEY-----", []);
    expect(f).toEqual([{ line: 1, kind: "pattern", patternType: "pem-private-key" }]);
  });

  it("dedupes per line + identity", () => {
    const text = "tok tok"; // same vaulted value twice on one line
    const f = scanForSecrets(text, [{ name: "T", value: "tok" === "tok" ? "tok " : "" }]);
    // value "tok " (4 chars incl. space) appears twice on line 1 -> one finding
    expect(f.filter((x) => x.name === "T")).toHaveLength(1);
  });

  it("never includes the secret value in any finding", () => {
    const value = "topsecretpassword";
    const f = scanForSecrets(`pw=${value}`, [{ name: "PW", value }]);
    expect(JSON.stringify(f)).not.toContain(value);
    expect(f).toEqual([{ line: 1, kind: "vaulted", name: "PW" }]);
  });
});
