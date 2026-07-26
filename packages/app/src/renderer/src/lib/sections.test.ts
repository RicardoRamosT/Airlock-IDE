import { describe, expect, it } from "vitest";
import {
  BUILTIN_SECTION_META,
  composeSectionMeta,
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
      kind: "extension",
    });
    // Built-ins keep their order and their kind.
    expect(meta[0]?.id).toBe("files");
    expect(meta[0]?.kind).toBe("builtin");
  });

  it("falls back to a generic icon when the extension declares none", () => {
    const meta = composeSectionMeta([{ id: "acme", name: "Acme" }]);
    expect(meta[meta.length - 1]?.icon).toBe("extensions");
  });

  it("preserves the order the extensions arrive in", () => {
    const meta = composeSectionMeta([
      { id: "slack", name: "Slack" },
      { id: "github", name: "GitHub" },
    ]);
    const ids = meta.filter((m) => m.kind === "extension").map((m) => m.id);
    expect(ids).toEqual(["ext:slack", "ext:github"]);
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

  it("returns null when everything is hidden", () => {
    const none = Object.fromEntries(meta.map((m) => [m.id, false]));
    expect(effectiveView("files", none, meta)).toBeNull();
  });
});
