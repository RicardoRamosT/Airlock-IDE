import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSessionSecrets,
  getSessionSecretValue,
  hasSessionSecret,
  listSessionSecretNames,
  putSessionSecret,
  sessionSecretValues,
} from "./session";

beforeEach(() => clearSessionSecrets());

describe("session secret store", () => {
  it("stores a value and returns it for the same root", () => {
    putSessionSecret("/a", "TOKEN", "abc", "az show");
    expect(getSessionSecretValue("/a", "TOKEN")).toBe("abc");
    expect(hasSessionSecret("/a", "TOKEN")).toBe(true);
  });

  it("isolates roots -- another project never sees it", () => {
    putSessionSecret("/a", "TOKEN", "abc", "az show");
    expect(getSessionSecretValue("/b", "TOKEN")).toBeNull();
    expect(hasSessionSecret("/b", "TOKEN")).toBe(false);
  });

  it("reports byte length, not character length", () => {
    // Escape form keeps this file ASCII on disk while still exercising a
    // genuinely multibyte UTF-8 value at runtime: 2 chars, 3 bytes (U+00E9
    // encodes as 2 UTF-8 bytes), so this can only pass with Buffer.byteLength
    // -- a value.length-based implementation would report 2, not 3.
    const value = "a\u00e9";
    const meta = putSessionSecret("/a", "T", value, "cmd");
    expect(meta.bytes).toBe(3);
    expect(meta.bytes).not.toBe(value.length);
  });

  it("lists metadata that carries no value", () => {
    putSessionSecret("/a", "T", "super-secret-value", "cmd");
    const list = listSessionSecretNames("/a");
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("T");
    expect(JSON.stringify(list)).not.toContain("super-secret-value");
  });

  it("overwrites the same name in place rather than duplicating", () => {
    putSessionSecret("/a", "T", "one", "cmd1");
    putSessionSecret("/a", "T", "two", "cmd2");
    expect(getSessionSecretValue("/a", "T")).toBe("two");
    expect(listSessionSecretNames("/a")).toHaveLength(1);
  });

  it("gathers values for the redaction set", () => {
    putSessionSecret("/a", "T1", "v1", "cmd");
    putSessionSecret("/a", "T2", "v2", "cmd");
    expect(sessionSecretValues("/a").sort()).toEqual(["v1", "v2"]);
    expect(sessionSecretValues("/b")).toEqual([]);
  });

  it("clears one root without touching another", () => {
    putSessionSecret("/a", "T", "a", "cmd");
    putSessionSecret("/b", "T", "b", "cmd");
    clearSessionSecrets("/a");
    expect(getSessionSecretValue("/a", "T")).toBeNull();
    expect(getSessionSecretValue("/b", "T")).toBe("b");
  });
});
