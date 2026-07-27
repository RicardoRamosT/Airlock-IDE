import { describe, expect, it } from "vitest";
import { sidebarViewFor } from "./extensionViews";

// CRITICAL #1 (2026-07-27 fix wave): snowflake/azure/vercel are section
// extensions (SECTION_EXTENSIONS) whose rail icon is ALWAYS shown, but they had
// no entry here -- so Sidebar.tsx fell through to ExtensionResourcesSection,
// whose data source (extensions:resourcesFor) only knows Tier-2
// CONNECTED_PROVIDERS ids and returns [] for any of these three, rendering a
// permanent "Nothing to show yet." with no reason. This assertion FAILS
// against the pre-fix map, which had no entry for any of the three ids.
describe("EXTENSION_VIEWS (via sidebarViewFor)", () => {
  it("registers a bespoke Sidebar for every extension that owns a rail section", () => {
    for (const id of [
      "slack",
      "neon",
      "docker",
      "render",
      "snowflake",
      "azure",
      "vercel",
    ]) {
      expect(sidebarViewFor(id), id).not.toBeNull();
    }
  });

  it("falls back to null for an id with no bespoke view", () => {
    expect(sidebarViewFor("nope")).toBeNull();
  });
});
