import { describe, expect, it } from "vitest";
import { compareVersions, isNewer } from "./version";

describe("compareVersions / isNewer", () => {
  it("orders numeric segments", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
    expect(compareVersions("0.2.0", "0.1.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("tolerates a leading v and unequal lengths", () => {
    expect(compareVersions("v0.2", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.0", "v0.2.1")).toBe(-1);
  });
  it("treats non-numeric segments as 0", () => {
    expect(compareVersions("0.2.x", "0.2.0")).toBe(0);
  });
  it("isNewer is true only when latest > current", () => {
    expect(isNewer("0.1.1", "0.2.0")).toBe(true);
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.2.0", "0.1.0")).toBe(false);
  });
});
