import { describe, expect, it } from "vitest";
import { resolveOverviewLink } from "./overviewLink";

describe("resolveOverviewLink", () => {
  it("resolves a ../ link (relative to .airlock/) to a root-relative path", () => {
    expect(resolveOverviewLink("../packages/app/src/main/index.ts")).toBe(
      "packages/app/src/main/index.ts",
    );
  });
  it("collapses ./ and nested .. segments", () => {
    expect(resolveOverviewLink("../packages/../docs/x.md")).toBe("docs/x.md");
    expect(resolveOverviewLink("../a/./b.ts")).toBe("a/b.ts");
  });
  it("returns null for external and other-scheme URLs", () => {
    expect(resolveOverviewLink("https://example.com")).toBeNull();
    expect(resolveOverviewLink("javascript:alert(1)")).toBeNull();
  });
  it("returns null for absolute paths and bare anchors", () => {
    expect(resolveOverviewLink("/etc/passwd")).toBeNull();
    expect(resolveOverviewLink("#section")).toBeNull();
  });
  it("returns null when a link escapes the project root", () => {
    expect(resolveOverviewLink("../../etc/passwd")).toBeNull();
  });
  it("returns null for empty input", () => {
    expect(resolveOverviewLink("")).toBeNull();
    expect(resolveOverviewLink("   ")).toBeNull();
  });
});
