import { describe, expect, it } from "vitest";
import type { CiRun } from "../../../shared/ipc";
import { ciDotClass, ciProgress, ciRunState, ciStateLabel } from "./ciFormat";

const run = (over: Partial<CiRun> = {}): CiRun => ({
  workflowName: "CI",
  status: "completed",
  conclusion: "success",
  headSha: "abc123",
  url: "https://github.com/o/r/actions/runs/1",
  steps: [],
  stepsDone: 0,
  stepsTotal: 0,
  ...over,
});

// Moved verbatim from main/activity.ts when the Activity panel was deleted.
// These cases are the reason it was moved rather than rewritten: which GitHub
// conclusions count as a failure is a list that is easy to get subtly wrong.
describe("ciRunState", () => {
  it("is running until GitHub says completed", () => {
    expect(ciRunState(run({ status: "queued", conclusion: null }))).toBe(
      "running",
    );
    expect(ciRunState(run({ status: "in_progress", conclusion: null }))).toBe(
      "running",
    );
  });

  it("is done only on success", () => {
    expect(ciRunState(run({ conclusion: "success" }))).toBe("done");
  });

  it("treats every failing conclusion as failed", () => {
    for (const c of [
      "failure",
      "cancelled",
      "timed_out",
      "action_required",
      "startup_failure",
      "stale",
    ]) {
      expect(ciRunState(run({ conclusion: c }))).toBe("failed");
    }
  });

  // Not a failure and not a success. Reporting either would be a guess, and a
  // skipped run painted red would send people to look at nothing.
  it("is idle for a conclusion that is neither, including an unknown one", () => {
    expect(ciRunState(run({ conclusion: "skipped" }))).toBe("idle");
    expect(ciRunState(run({ conclusion: "neutral" }))).toBe("idle");
    expect(ciRunState(run({ conclusion: "some_future_thing" }))).toBe("idle");
  });
});

describe("ciStateLabel", () => {
  it("distinguishes queued from running", () => {
    expect(ciStateLabel(run({ status: "queued", conclusion: null }))).toBe(
      "queued",
    );
    expect(ciStateLabel(run({ status: "in_progress", conclusion: null }))).toBe(
      "running",
    );
  });

  // "completed" alone does not tell you whether to go look at it.
  it("names the conclusion on a failure rather than just 'failed'", () => {
    expect(ciStateLabel(run({ conclusion: "timed_out" }))).toBe("timed_out");
  });

  it("says passed on success", () => {
    expect(ciStateLabel(run({ conclusion: "success" }))).toBe("passed");
  });
});

describe("ciProgress", () => {
  // The membership rule kept from the Activity panel: a determinate number ONLY
  // where there is discrete structure to count.
  it("is null when there are no steps to count", () => {
    expect(ciProgress(run({ stepsTotal: 0, stepsDone: 0 }))).toBeNull();
  });

  it("counts steps into a percentage and a label", () => {
    expect(ciProgress(run({ stepsDone: 3, stepsTotal: 4 }))).toEqual({
      value: 75,
      label: "3/4 steps",
    });
  });
});

describe("ciDotClass", () => {
  it("reuses the shared status-dot classes for every state", () => {
    expect(ciDotClass("done")).toBe("status-dot on");
    expect(ciDotClass("failed")).toBe("status-dot fail");
    expect(ciDotClass("running")).toBe("status-dot running");
    expect(ciDotClass("idle")).toBe("status-dot");
  });
});
