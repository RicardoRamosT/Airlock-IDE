import { describe, expect, it } from "vitest";
import { overlayActive } from "./dockSignals";

describe("overlayActive", () => {
  it("is true when any pane-covering overlay is open", () => {
    expect(
      overlayActive({ searchOpen: true, references: null, appPage: null }),
    ).toBe(true);
    expect(
      overlayActive({
        searchOpen: false,
        references: { symbol: "x", results: [] },
        appPage: null,
      }),
    ).toBe(true);
    expect(
      overlayActive({
        searchOpen: false,
        references: null,
        appPage: "settings",
      }),
    ).toBe(true);
  });
  it("is false when none are open", () => {
    expect(
      overlayActive({ searchOpen: false, references: null, appPage: null }),
    ).toBe(false);
  });
});
