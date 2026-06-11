import { describe, expect, it } from "vitest";
import { parseLatestRelease } from "./parse";

const release = (assets: { name: string; browser_download_url: string }[]) => ({
  tag_name: "v0.2.0",
  html_url: "https://github.com/RicardoRamosT/Airlock-IDE/releases/tag/v0.2.0",
  assets,
});

describe("parseLatestRelease", () => {
  it("picks the -arm64.dmg asset and strips the v from version", () => {
    const r = parseLatestRelease(
      release([
        { name: "AirLock-0.2.0-arm64.dmg", browser_download_url: "https://x/arm.dmg" },
      ]),
    );
    expect(r).toEqual({
      tag: "v0.2.0",
      version: "0.2.0",
      htmlUrl: "https://github.com/RicardoRamosT/Airlock-IDE/releases/tag/v0.2.0",
      dmgUrl: "https://x/arm.dmg",
    });
  });
  it("falls back to any .dmg, else null dmgUrl", () => {
    expect(
      parseLatestRelease(
        release([{ name: "AirLock.dmg", browser_download_url: "https://x/any.dmg" }]),
      )?.dmgUrl,
    ).toBe("https://x/any.dmg");
    expect(parseLatestRelease(release([]))?.dmgUrl).toBeNull();
  });
  it("returns null for malformed payloads", () => {
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease({})).toBeNull();
    expect(parseLatestRelease({ tag_name: "v1" })).toBeNull(); // no html_url
  });
});
