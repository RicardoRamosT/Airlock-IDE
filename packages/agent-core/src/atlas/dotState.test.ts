import { describe, expect, it } from "vitest";
import { dotState, type SpineInput } from "./dotState";

const base: SpineInput = {
  tree: { dirty: 0, branch: "main", hasRemote: true },
  ci: { status: "completed", conclusion: "success" },
  prs: [],
};

describe("dotState", () => {
  it("is clean only when all three inputs were read and all are healthy", () => {
    expect(dotState(base)).toBe("clean");
  });

  it("is fail when the latest run failed", () => {
    expect(
      dotState({ ...base, ci: { status: "completed", conclusion: "failure" } }),
    ).toBe("fail");
    expect(
      dotState({
        ...base,
        ci: { status: "completed", conclusion: "timed_out" },
      }),
    ).toBe("fail");
  });

  it("does not call a CANCELLED run broken", () => {
    // Someone stopping a run is not the project being broken.
    expect(
      dotState({
        ...base,
        ci: { status: "completed", conclusion: "cancelled" },
      }),
    ).not.toBe("fail");
  });

  it("is you when one of YOUR non-draft PRs is awaiting review", () => {
    expect(
      dotState({
        ...base,
        prs: [{ mine: true, awaitingReview: true, draft: false }],
      }),
    ).toBe("you");
  });

  it("does not go amber for a teammate's PR or your own draft", () => {
    // The whole point of asking GitHub for author/reviewDecision/isDraft.
    expect(
      dotState({
        ...base,
        prs: [
          { mine: false, awaitingReview: true, draft: false },
          { mine: true, awaitingReview: true, draft: true },
          { mine: true, awaitingReview: false, draft: false },
        ],
      }),
    ).toBe("clean");
  });

  it("ranks fail above you", () => {
    expect(
      dotState({
        ...base,
        ci: { status: "completed", conclusion: "failure" },
        prs: [{ mine: true, awaitingReview: true, draft: false }],
      }),
    ).toBe("fail");
  });

  it("is quiet when ANY input was not read, never clean", () => {
    // A failed gh call, a repo with no remote, a probe that has not returned.
    // None of those are "clean" -- green needs positive evidence on all three.
    expect(dotState({ ...base, ci: null })).toBe("quiet");
    expect(dotState({ ...base, prs: null })).toBe("quiet");
    expect(dotState({ ...base, tree: null })).toBe("quiet");
  });

  it("is quiet for a dirty tree rather than clean", () => {
    expect(
      dotState({
        ...base,
        tree: { dirty: 3, branch: "main", hasRemote: true },
      }),
    ).toBe("quiet");
  });

  it("is quiet when CI has not concluded yet", () => {
    // A run in flight is not a verdict either way.
    expect(
      dotState({ ...base, ci: { status: "in_progress", conclusion: null } }),
    ).toBe("quiet");
  });

  it("still reports fail when the tree was not read", () => {
    // A broken build is worth saying even if the local probe lagged.
    expect(
      dotState({
        tree: null,
        ci: { status: "completed", conclusion: "failure" },
        prs: null,
      }),
    ).toBe("fail");
  });
});
