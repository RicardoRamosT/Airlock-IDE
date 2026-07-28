import { describe, expect, it } from "vitest";
import {
  BUILTIN_SECTION_META,
  composeSectionMeta,
  EXTENSIONS_HUB_SECTION,
  effectiveView,
  extSectionId,
  parseExtSection,
} from "./sections";

describe("ext section ids", () => {
  it("round-trips an extension id", () => {
    expect(extSectionId("slack")).toBe("ext:slack");
    expect(parseExtSection("ext:slack")).toBe("slack");
  });

  it("rejects anything that is not an ext id", () => {
    expect(parseExtSection("files")).toBeNull();
    expect(parseExtSection("ext:")).toBeNull();
    expect(parseExtSection("")).toBeNull();
  });
});

describe("composeSectionMeta", () => {
  it("returns the built-ins unchanged when there are no extensions", () => {
    expect(composeSectionMeta([])).toEqual(BUILTIN_SECTION_META);
  });

  it("appends extension entries AFTER the built-ins, tagged as extension", () => {
    const meta = composeSectionMeta([
      { id: "slack", name: "Slack", icon: "comment-discussion" },
    ]);
    expect(meta).toHaveLength(BUILTIN_SECTION_META.length + 1);
    const last = meta[meta.length - 1];
    expect(last).toEqual({
      id: "ext:slack",
      label: "Slack",
      icon: "comment-discussion",
      group: "extensions",
    });
    // Built-ins keep their order and their kind.
    expect(meta[0]?.id).toBe("files");
    expect(meta[0]?.group).toBe("core");
  });

  it("falls back to a generic icon when the extension declares none", () => {
    const meta = composeSectionMeta([{ id: "acme", name: "Acme" }]);
    expect(meta[meta.length - 1]?.icon).toBe("extensions");
  });

  it("sorts extensions alphabetically by name, not arrival order", () => {
    const meta = composeSectionMeta([
      { id: "slack", name: "Slack" },
      { id: "github", name: "GitHub" },
    ]);
    const ids = meta.filter((m) => m.id.startsWith("ext:")).map((m) => m.id);
    expect(ids).toEqual(["ext:github", "ext:slack"]);
  });
});

describe("rail groups", () => {
  it("puts the Extensions hub FIRST in the extensions group, not among the core icons", () => {
    const meta = composeSectionMeta([
      { id: "slack", name: "Slack" },
      { id: "github", name: "GitHub" },
    ]);
    const groups = meta.map((m) => m.group);
    // Every core icon precedes every extensions-group icon.
    expect(groups.lastIndexOf("core")).toBeLessThan(
      groups.indexOf("extensions"),
    );
    // And the hub leads that group.
    const extGroup = meta.filter((m) => m.group === "extensions");
    expect(extGroup[0]?.id).toBe(EXTENSIONS_HUB_SECTION);
    // Alphabetical by name ("GitHub" before "Slack"), not arrival order.
    expect(extGroup.map((m) => m.id)).toEqual([
      "extensions",
      "ext:github",
      "ext:slack",
    ]);
  });

  it("keeps the hub in the extensions group even with no extensions connected", () => {
    const meta = composeSectionMeta([]);
    const last = meta[meta.length - 1];
    expect(last?.id).toBe(EXTENSIONS_HUB_SECTION);
    expect(last?.group).toBe("extensions");
  });

  it("leaves the core icons in their canonical order", () => {
    expect(
      composeSectionMeta([])
        .filter((m) => m.group === "core")
        .map((m) => m.id),
    ).toEqual([
      "files",
      "secrets",
      "git",
      "databases",
      "host",
      "audit",
      "events",
    ]);
  });
});

describe("effectiveView", () => {
  const meta = composeSectionMeta([{ id: "slack", name: "Slack" }]);
  const allVisible = Object.fromEntries(meta.map((m) => [m.id, true]));

  it("keeps the active view when it is visible", () => {
    expect(effectiveView("git", allVisible, meta)).toBe("git");
  });

  it("keeps an active EXTENSION view when visible", () => {
    expect(effectiveView("ext:slack", allVisible, meta)).toBe("ext:slack");
  });

  it("falls back to the first visible section when the active one is hidden", () => {
    expect(effectiveView("git", { ...allVisible, git: false }, meta)).toBe(
      "files",
    );
  });

  it("falls back when an extension section DISAPPEARS (extension disabled)", () => {
    // ext:slack is active but no longer in meta at all -- must not return it.
    const without = composeSectionMeta([]);
    const vis = Object.fromEntries(without.map((m) => [m.id, true]));
    expect(effectiveView("ext:slack", vis, without)).toBe("files");
  });

  it("treats a section with NO visibility entry as VISIBLE", () => {
    // A newly-appeared extension section has no persisted key yet; absent must
    // mean visible (matching main's listSidebarSections `!== false`), or the
    // icon never shows up at all.
    expect(effectiveView("ext:slack", {}, meta)).toBe("ext:slack");
    expect(effectiveView("files", {}, meta)).toBe("files");
  });

  it("still honours an EXPLICIT false for an extension section", () => {
    expect(effectiveView("ext:slack", { "ext:slack": false }, meta)).toBe(
      "files",
    );
  });

  it("returns null when everything is hidden", () => {
    const none = Object.fromEntries(meta.map((m) => [m.id, false]));
    expect(effectiveView("files", none, meta)).toBeNull();
  });

  // The hub moved to a page, so this id has no sidebar body. A prefs file
  // written by an older build can still name it as the active view; the
  // sidebar must fall back to a real section rather than render nothing.
  it("falls back when the persisted active view is the hub", () => {
    expect(effectiveView("extensions", {}, BUILTIN_SECTION_META)).toBe("files");
  });
});

describe("composeSectionMeta with section extensions", () => {
  // Extensions all live below the rail divider, in one group, in a stable order:
  // connected first, then section extensions, each alphabetical. A rail whose
  // icons move between projects destroys muscle memory.
  it("places section extensions in the extensions group after connected ones", () => {
    const meta = composeSectionMeta(
      [{ id: "slack", name: "Slack", icon: "slack" }],
      [
        { id: "neon", name: "Neon", icon: "neon" },
        { id: "docker", name: "Docker", icon: "docker" },
      ],
    );
    const ext = meta.filter((m) => m.group === "extensions").map((m) => m.id);
    expect(ext).toEqual(["extensions", "ext:slack", "ext:docker", "ext:neon"]);
  });

  it("gives a section extension its brand icon and name", () => {
    const meta = composeSectionMeta(
      [],
      [{ id: "neon", name: "Neon", icon: "neon" }],
    );
    const neon = meta.find((m) => m.id === "ext:neon");
    expect(neon).toMatchObject({
      label: "Neon",
      icon: "neon",
      group: "extensions",
    });
  });

  it("still works with no section extensions", () => {
    expect(composeSectionMeta([]).some((m) => m.id === "ext:neon")).toBe(false);
  });
});

// The two lists are selected by DIFFERENT filters in useSyncSectionMeta --
// `tier === "connected"` and `hasSection === true` -- and since 2026-07-27 a
// connected extension satisfies both (it owns a rail area, which is what lets
// the hub offer "Open <name>"). Concatenating them blindly gave Slack two rail
// icons with the same id. Deduped here rather than by re-narrowing the filters,
// because two entries for one id are never wanted whoever produced them.
it("lists an extension once even when it arrives in BOTH lists", () => {
  const slack = { id: "slack", name: "Slack", icon: "slack" };
  const meta = composeSectionMeta([slack], [slack]);
  const slackRows = meta.filter((m) => m.id === "ext:slack");
  expect(slackRows.length).toBe(1);
});

// The connected list wins the position, so a connected extension keeps sitting
// among the connected icons rather than jumping down to the section group.
it("keeps the FIRST occurrence, so rail order is unchanged", () => {
  const a = { id: "slack", name: "Slack", icon: "slack" };
  const b = { id: "docker", name: "Docker", icon: "docker" };
  const meta = composeSectionMeta([a], [b, a]);
  // Filtered by the `ext:` prefix, not by group: the extensions HUB itself is
  // in the "extensions" group and is not one of these rows.
  const ids = meta.map((m) => m.id).filter((id) => id.startsWith("ext:"));
  expect(ids).toEqual(["ext:slack", "ext:docker"]);
});
