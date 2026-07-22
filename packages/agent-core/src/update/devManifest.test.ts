import { describe, expect, it } from "vitest";
import {
  isLocalBuildNewer,
  parseDevManifest,
  pickUpdateSource,
} from "./devManifest";

describe("parseDevManifest", () => {
  it("parses a valid manifest", () => {
    expect(
      parseDevManifest({
        appPath: "/x/AirLock.app",
        version: "0.5.0",
        builtAt: 123,
      }),
    ).toEqual({ appPath: "/x/AirLock.app", version: "0.5.0", builtAt: 123 });
  });
  it("returns null on garbage / missing / wrong-typed / empty fields", () => {
    expect(parseDevManifest(null)).toBeNull();
    expect(parseDevManifest("nope")).toBeNull();
    expect(
      parseDevManifest({ appPath: "", version: "0.5.0", builtAt: 1 }),
    ).toBeNull();
    expect(
      parseDevManifest({ appPath: "/x", version: "", builtAt: 1 }),
    ).toBeNull();
    expect(
      parseDevManifest({ appPath: "/x", version: "0.5.0", builtAt: 0 }),
    ).toBeNull();
    expect(
      parseDevManifest({ appPath: "/x", version: "0.5.0", builtAt: "1" }),
    ).toBeNull();
    expect(parseDevManifest({ appPath: "/x", version: "0.5.0" })).toBeNull();
  });
});

describe("isLocalBuildNewer", () => {
  it("true only when the local build time exceeds the running one", () => {
    expect(isLocalBuildNewer(200, 100)).toBe(true);
    expect(isLocalBuildNewer(100, 100)).toBe(false);
    expect(isLocalBuildNewer(50, 100)).toBe(false);
  });
});

describe("pickUpdateSource", () => {
  it("prefers a local app path (dev channel) over the DMG", () => {
    expect(
      pickUpdateSource({
        localAppPath: "/x/AirLock.app",
        dmgUrl: "https://d.dmg",
      }),
    ).toEqual({ kind: "local", appPath: "/x/AirLock.app" });
  });
  it("falls back to the DMG url", () => {
    expect(
      pickUpdateSource({ localAppPath: null, dmgUrl: "https://d.dmg" }),
    ).toEqual({ kind: "dmg", url: "https://d.dmg" });
  });
  it("null when neither is present", () => {
    expect(pickUpdateSource({ localAppPath: null, dmgUrl: null })).toBeNull();
    expect(pickUpdateSource({})).toBeNull();
  });
});
