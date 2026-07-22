import { describe, expect, it } from "vitest";
import { isSettablePref } from "./prefWrite";

describe("isSettablePref", () => {
  it("allows benign UI/feature toggles", () => {
    for (const k of [
      "quotaMeter",
      "runAppSkill",
      "dockStatus",
      "theme",
      "sectionVisibility",
      "openProjectsAsTabs",
      "claudeAutoStart",
      "defaultTerminal",
      "restoreSession",
      "clipboardClearSeconds",
      "activeView",
      "sidebarVisible",
    ]) {
      expect(isSettablePref(k), k).toBe(true);
    }
  });
  it("refuses security-sensitive + unknown keys", () => {
    for (const k of ["agentPolicy", "selfVerify", "eventLog", "nope", ""]) {
      expect(isSettablePref(k), k).toBe(false);
    }
  });
});
