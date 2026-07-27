import { describe, expect, it } from "vitest";
import { AZURE, SNOWFLAKE } from "./registry";
import type { ExtensionSummary } from "./summary";
import {
  buildExtensionSummaries,
  enabledManifests,
  mergeSectionExtensions,
  pinnedEnabledManifests,
  sectionExtensionSummaries,
} from "./summary";

describe("buildExtensionSummaries", () => {
  it("maps status, category, tier and prefs; disabled overrides status", () => {
    const out = buildExtensionSummaries(
      [SNOWFLAKE, AZURE],
      { snowflake: "ready", azure: "unauthed" },
      { azure: { pinned: true }, snowflake: { enabled: false } },
    );
    const v = out.find((e) => e.id === "snowflake");
    const a = out.find((e) => e.id === "azure");
    if (!v || !a) throw new Error("missing summary");

    // snowflake: enabled:false wins over its "ready" detect status
    expect(v.status).toBe("disabled");
    expect(v.enabled).toBe(false);
    expect(v.pinned).toBe(false);
    // A {view} surface becomes that view's category. (An activity-surfaced
    // manifest would map to "activity" -- none ship today, and the
    // "linear" fixture further down still covers that branch.)
    expect(v.category).toBe("databases");
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
    // snowflake carries its own pair, distinct from azure's
    expect(v.install?.command).toContain("snow");
    expect(v.connect?.command).toContain("snow");
  });

  it("defaults a missing status to absent and missing prefs to enabled/unpinned", () => {
    const v = buildExtensionSummaries([SNOWFLAKE], {}, {})[0];
    if (!v) throw new Error("missing summary");
    expect(v.status).toBe("absent");
    expect(v.enabled).toBe(true);
    expect(v.pinned).toBe(false);
  });

  it("folds an accounts entry onto the matching status row", () => {
    const out = buildExtensionSummaries(
      [AZURE],
      { azure: "ready" },
      {},
      { azure: "My-Sub" },
    );
    expect(out[0]?.account).toBe("My-Sub");
  });

  it("leaves account undefined when no accounts map is given", () => {
    const out = buildExtensionSummaries([AZURE], { azure: "ready" }, {});
    expect(out[0]?.account).toBeUndefined();
  });
});

describe("pinnedEnabledManifests", () => {
  it("keeps only pinned AND not-disabled", () => {
    const r = pinnedEnabledManifests([SNOWFLAKE, AZURE], {
      azure: { pinned: true },
      snowflake: { pinned: true, enabled: false }, // pinned but disabled -> dropped
    });
    expect(r.map((m) => m.id)).toEqual(["azure"]);
  });
});

describe("enabledManifests", () => {
  it("drops only explicitly-disabled manifests", () => {
    const r = enabledManifests([SNOWFLAKE, AZURE], {
      snowflake: { enabled: false },
    });
    expect(r.map((m) => m.id)).toEqual(["azure"]);
  });
});

// The hub is the discovery surface, and it did not list Neon or Docker at all
// -- so "go to Extensions to see what exists" was a dead end for exactly the
// services this reorganization is about.
describe("sectionExtensionSummaries", () => {
  const descriptors = [
    {
      id: "neon",
      name: "Neon",
      icon: "neon",
      contributesTo: "databases" as const,
      description: "d",
    },
    {
      id: "docker",
      name: "Docker",
      icon: "docker",
      contributesTo: "databases" as const,
      description: "d",
    },
  ];

  it("produces a hub row per descriptor, tiered as section", () => {
    const rows = sectionExtensionSummaries(descriptors, {});
    expect(rows.map((r) => [r.id, r.tier])).toEqual([
      ["neon", "section"],
      ["docker", "section"],
    ]);
  });

  it("carries the brand icon and the category it contributes to", () => {
    const [neon] = sectionExtensionSummaries(descriptors, {});
    expect(neon).toMatchObject({ icon: "neon", category: "databases" });
  });

  // The status used to be a hardcoded "ready" -- a claim the registry could not
  // back up, which forced every hub surface to special-case tier === "section"
  // and produced a bucket ("Has its own section") that answered nothing.
  it("takes each row's status from the probed map", () => {
    const rows = sectionExtensionSummaries(
      descriptors,
      {},
      {
        neon: "connected",
        docker: "absent",
      },
    );
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["neon", "connected"],
      ["docker", "absent"],
    ]);
  });

  it("reports an unprobed id as absent rather than claiming it is connected", () => {
    const rows = sectionExtensionSummaries(descriptors, {}, {});
    expect(rows.every((r) => r.status === "absent")).toBe(true);
  });

  it("defaults to enabled and honours an explicit disable", () => {
    const rows = sectionExtensionSummaries(descriptors, {
      docker: { enabled: false },
    });
    expect(rows.map((r) => r.enabled)).toEqual([true, false]);
  });
});

// The duplicate-row bug (found 2026-07-27, filed against the whole-branch
// review that shipped sectionExtensionSummaries): snowflake/azure are
// EACH both a real IntegrationManifest (INTEGRATIONS) and a SECTION_EXTENSIONS
// descriptor, and extensions:list used to concatenate buildExtensionSummaries
// and sectionExtensionSummaries with no dedup -- so the hub listed each of
// these three TWICE: once with a real detect status, once with
// sectionExtensionSummaries' placeholder "ready". Every assertion below would
// FAIL against that naive concatenation (`[...tier1, ...sectionRows]`), which
// is exactly the pre-fix behavior -- confirmed by temporarily swapping
// mergeSectionExtensions for that one-liner and re-running this file (all
// six tests below failed; restored and re-ran green).
describe("mergeSectionExtensions", () => {
  const status = (
    id: string,
    icon: string,
    category: string | undefined,
    detectStatus: ExtensionSummary["status"],
  ): ExtensionSummary => ({
    id,
    name: id,
    icon,
    tier: "status",
    category,
    status: detectStatus,
    enabled: true,
    pinned: false,
    hasConfig: false,
    authKind: "token",
  });

  const section = (
    id: string,
    icon: string,
    category: string | undefined,
  ): ExtensionSummary => ({
    id,
    name: id,
    icon,
    tier: "section",
    category,
    status: "ready",
    enabled: true,
    pinned: false,
    hasConfig: false,
    authKind: "token",
  });

  // Mirrors the real shape: INTEGRATIONS = [snowflake, azure] (real
  // detect status, generic codicon icons), SECTION_EXTENSIONS = [neon, docker,
  // render, snowflake, azure] (placeholder "ready", brand icons).
  const tier1 = [
    status("snowflake", "database", "databases", "ready"),
    status("azure", "cloud", "host", "unauthed"),
  ];
  const sectionRows = [
    section("neon", "neon", "databases"),
    section("docker", "docker", "databases"),
    section("render", "render", "host"),
    section("snowflake", "snowflake", "databases"),
    section("azure", "azure", "host"),
  ];

  it("produces exactly one row per id -- no duplicates for an overlapping id", () => {
    const out = mergeSectionExtensions(tier1, sectionRows);
    const ids = out.map((r) => r.id);
    expect([...ids].sort()).toEqual(
      ["azure", "docker", "neon", "render", "snowflake"].sort(),
    );
    expect(new Set(ids).size).toBe(ids.length); // no id repeats
  });

  it("the manifest row wins for an overlapping id: real status, not the placeholder", () => {
    const out = mergeSectionExtensions(tier1, sectionRows);
    expect(out.find((r) => r.id === "snowflake")).toMatchObject({
      tier: "status",
      status: "ready",
    });
    expect(out.find((r) => r.id === "azure")).toMatchObject({
      tier: "status",
      status: "unauthed",
    });
    // ...while a NON-overlapping id keeps its section row untouched.
    expect(out.find((r) => r.id === "neon")).toMatchObject({
      tier: "section",
      status: "ready",
    });
  });

  it("keeps the section descriptor's brand icon on the surviving manifest row", () => {
    const out = mergeSectionExtensions(tier1, sectionRows);
    // The Tier-1 manifest's own icon ("rocket"/"database"/"cloud") is a
    // generic codicon; SectionGlyph only renders a brand mark for the
    // SECTION_EXTENSIONS icon id ("snowflake"/"azure"), so keeping
    // the manifest's own icon here would visibly regress the rail icon.
    expect(out.find((r) => r.id === "snowflake")?.icon).toBe("snowflake");
    expect(out.find((r) => r.id === "azure")?.icon).toBe("azure");
    expect(out.find((r) => r.id === "snowflake")?.icon).toBe("snowflake");
  });

  it("keeps the manifest row's own category, not the section descriptor's", () => {
    const out = mergeSectionExtensions(tier1, sectionRows);
    // The manifest's own category wins over the descriptor's
    // to surface into); its SECTION_EXTENSIONS descriptor has none at all.
    expect(out.find((r) => r.id === "snowflake")?.category).toBe("databases");
  });

  it("flags every surviving row hasSection: true, overlapping or not", () => {
    const out = mergeSectionExtensions(tier1, sectionRows);
    for (const id of ["neon", "docker", "render", "snowflake", "azure"]) {
      expect(out.find((r) => r.id === id)?.hasSection, id).toBe(true);
    }
  });

  it("never drops neon/docker/render, which have no manifest counterpart", () => {
    const out = mergeSectionExtensions(tier1, sectionRows);
    expect(out.find((r) => r.id === "neon")).toMatchObject({
      tier: "section",
      status: "ready",
    });
    expect(out.find((r) => r.id === "docker")).toMatchObject({
      tier: "section",
    });
    expect(out.find((r) => r.id === "render")).toMatchObject({
      tier: "section",
    });
  });

  it("marks a Tier-1 row with no section counterpart as hasSection: false", () => {
    const out = mergeSectionExtensions(
      [status("linear", "codicon-x", "activity", "ready")],
      sectionRows,
    );
    expect(out.find((r) => r.id === "linear")?.hasSection).toBe(false);
  });
});
