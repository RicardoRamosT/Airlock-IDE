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
