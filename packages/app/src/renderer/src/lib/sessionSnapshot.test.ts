import { describe, expect, it } from "vitest";
import { buildSessionSnapshot } from "./sessionSnapshot";

const tt = (claudeAutoId: string | null) => ({
  terminals: [],
  activeTerminalId: null,
  splitTerminalId: null,
  claudeAutoId,
});

describe("buildSessionSnapshot", () => {
  it("maps project tabs in stripOrder, hadClaude from claudeAutoId, skips blanks", () => {
    const state = {
      tabs: [
        { id: "t1", root: "/a" },
        { id: "t2", root: null }, // blank -> skipped
        { id: "t3", root: "/c" },
      ],
      activeTabId: "t3",
      split: null,
      stripOrder: ["t3", "t1"], // strip order overrides tabs order
      tabTerminals: { t1: tt("e1"), t3: tt(null) },
    };
    expect(buildSessionSnapshot(state)).toEqual({
      version: 1,
      tabs: [
        { root: "/c", hadClaude: false },
        { root: "/a", hadClaude: true },
      ],
      activeRoot: "/c",
      split: null,
    });
  });

  it("treats a pending-resume tab as hadClaude even before it has a terminal", () => {
    // A restored tab you have not switched to yet is pending resume: no terminal,
    // claudeAutoId still null. It MUST persist hadClaude=true or the next restore
    // drops it and fresh-starts claude instead of resuming. (Regression: only the
    // active tab resumed because the others saved hadClaude=false.)
    const state = {
      tabs: [{ id: "t1", root: "/a" }],
      activeTabId: "t1",
      split: null,
      stripOrder: ["t1"],
      tabTerminals: { t1: tt(null) }, // not visited/resumed yet
      pendingResume: new Set(["t1"]),
    };
    expect(buildSessionSnapshot(state).tabs[0]?.hadClaude).toBe(true);
  });

  it("maps the split pair from tab ids to roots", () => {
    const state = {
      tabs: [
        { id: "t1", root: "/a" },
        { id: "t2", root: "/b" },
      ],
      activeTabId: "t1",
      split: { a: "t1", b: "t2" },
      stripOrder: [],
      tabTerminals: { t1: tt("e1"), t2: tt("e2") },
    };
    expect(buildSessionSnapshot(state).split).toEqual({ a: "/a", b: "/b" });
  });
});
