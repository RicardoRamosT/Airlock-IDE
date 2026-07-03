import { describe, expect, it } from "vitest";
import { AZURE, VERCEL } from "./registry";
import {
  buildExtensionSummaries,
  enabledManifests,
  pinnedEnabledManifests,
} from "./summary";

describe("buildExtensionSummaries", () => {
  it("maps status, category, tier and prefs; disabled overrides status", () => {
    const out = buildExtensionSummaries(
      [VERCEL, AZURE],
      { vercel: "ready", azure: "unauthed" },
      { azure: { pinned: true }, vercel: { enabled: false } },
    );
    const v = out.find((e) => e.id === "vercel");
    const a = out.find((e) => e.id === "azure");
    if (!v || !a) throw new Error("missing summary");

    // vercel: enabled:false wins over its "ready" detect status
    expect(v.status).toBe("disabled");
    expect(v.enabled).toBe(false);
    expect(v.pinned).toBe(false);
    expect(v.category).toBeUndefined(); // activity-surfaced -> no category
    expect(v.tier).toBe("status");
    expect(v.hasConfig).toBe(false);

    // azure: steady {view:"host"} + pinned + detect passthrough
    expect(a.status).toBe("unauthed");
    expect(a.category).toBe("host");
    expect(a.pinned).toBe(true);
    expect(a.enabled).toBe(true);
    expect(a.icon).toBe("cloud");
    // install/connect carried through from the manifest (for Hub action buttons)
    expect(a.install?.command).toBe("brew install azure-cli");
    expect(a.connect?.command).toBe("az login");
    // vercel has neither -> undefined
    expect(v.install).toBeUndefined();
    expect(v.connect).toBeUndefined();
  });

  it("defaults a missing status to absent and missing prefs to enabled/unpinned", () => {
    const v = buildExtensionSummaries([VERCEL], {}, {})[0];
    if (!v) throw new Error("missing summary");
    expect(v.status).toBe("absent");
    expect(v.enabled).toBe(true);
    expect(v.pinned).toBe(false);
  });
});

describe("pinnedEnabledManifests", () => {
  it("keeps only pinned AND not-disabled", () => {
    const r = pinnedEnabledManifests([VERCEL, AZURE], {
      azure: { pinned: true },
      vercel: { pinned: true, enabled: false }, // pinned but disabled -> dropped
    });
    expect(r.map((m) => m.id)).toEqual(["azure"]);
  });
});

describe("enabledManifests", () => {
  it("drops only explicitly-disabled manifests", () => {
    const r = enabledManifests([VERCEL, AZURE], { vercel: { enabled: false } });
    expect(r.map((m) => m.id)).toEqual(["azure"]);
  });
});
