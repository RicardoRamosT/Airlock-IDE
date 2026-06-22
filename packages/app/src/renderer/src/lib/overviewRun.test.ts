import { describe, expect, it } from "vitest";
import { planOverviewRun } from "./overviewRun";

const tt = (
  over: Partial<{
    terminals: { id: string; ptyId: string | null }[];
    activeTerminalId: string | null;
    claudeAutoId: string | null;
  }> = {},
) => ({
  terminals: [{ id: "t1", ptyId: "p1" }],
  activeTerminalId: "t1",
  claudeAutoId: null,
  ...over,
});

describe("planOverviewRun", () => {
  it("spawns when there is no tab-terminals entry", () => {
    expect(planOverviewRun(undefined, {})).toEqual({ mode: "spawn" });
  });
  it("spawns when no terminal id resolves", () => {
    expect(
      planOverviewRun(tt({ activeTerminalId: null, claudeAutoId: null }), {}),
    ).toEqual({ mode: "spawn" });
  });
  it("spawns when the resolved terminal has no live pty", () => {
    expect(
      planOverviewRun(tt({ terminals: [{ id: "t1", ptyId: null }] }), {}),
    ).toEqual({ mode: "spawn" });
  });
  it("reuses the live pty, not busy", () => {
    expect(planOverviewRun(tt(), {})).toEqual({
      mode: "reuse",
      termId: "t1",
      ptyId: "p1",
      busy: false,
    });
  });
  it("flags busy from sessionWorking", () => {
    expect(planOverviewRun(tt(), { p1: true })).toEqual({
      mode: "reuse",
      termId: "t1",
      ptyId: "p1",
      busy: true,
    });
  });
  it("prefers the claudeAuto terminal over the active one", () => {
    const v = tt({
      terminals: [
        { id: "t1", ptyId: "p1" },
        { id: "tc", ptyId: "pc" },
      ],
      activeTerminalId: "t1",
      claudeAutoId: "tc",
    });
    expect(planOverviewRun(v, {})).toEqual({
      mode: "reuse",
      termId: "tc",
      ptyId: "pc",
      busy: false,
    });
  });
});
