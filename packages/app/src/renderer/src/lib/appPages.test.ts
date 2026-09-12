import { describe, expect, it } from "vitest";
import { APP_PAGES } from "../../../shared/ipc";
import { type AppPageFlags, anyAppPageOpen, openAppPages } from "./appPages";

const NONE: AppPageFlags = {
  settingsTabOpen: false,
  usageTabOpen: false,
  extensionsTabOpen: false,
};

describe("openAppPages", () => {
  // The invariant the Extensions page-tab broke: every page in APP_PAGES must
  // be REACHABLE. A page that no flag maps to is the silent-omission bug, and
  // it is exactly what shipped -- so bind the enumeration to reality here
  // rather than trusting three call sites to stay in step.
  it.each([...APP_PAGES])("reports %s as open when its flag is set", (page) => {
    const flags = { ...NONE };
    if (page === "settings") flags.settingsTabOpen = true;
    if (page === "usage") flags.usageTabOpen = true;
    if (page === "extensions") flags.extensionsTabOpen = true;
    expect(openAppPages(flags)).toEqual([page]);
    expect(anyAppPageOpen(flags)).toBe(true);
  });

  it("is empty with nothing open", () => {
    expect(openAppPages(NONE)).toEqual([]);
    expect(anyAppPageOpen(NONE)).toBe(false);
  });

  it("keeps strip order, not the order flags were set", () => {
    expect(
      openAppPages({
        settingsTabOpen: true,
        usageTabOpen: true,
        extensionsTabOpen: true,
      }),
    ).toEqual([...APP_PAGES]);
  });
});
