import { describe, expect, it, vi } from "vitest";
import { AIRLOCK_REPO, fetchLatestRelease } from "./client";

describe("fetchLatestRelease", () => {
  it("requests the repo's latest-release endpoint and parses it", async () => {
    const get = vi.fn(async () => ({
      tag_name: "v0.3.0",
      html_url: "https://h",
      assets: [
        {
          name: "AirLock-0.3.0-arm64.dmg",
          browser_download_url: "https://d.dmg",
        },
      ],
    }));
    const r = await fetchLatestRelease(AIRLOCK_REPO, { transport: { get } });
    expect(get).toHaveBeenCalledWith(
      "https://api.github.com/repos/RicardoRamosT/Airlock-IDE/releases/latest",
    );
    expect(r?.version).toBe("0.3.0");
    expect(r?.dmgUrl).toBe("https://d.dmg");
  });
});
