import type { CiRun } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import {
  ciRunState,
  ciRunToItem,
  dockerContainerToItem,
  renderDeployState,
  renderServiceToItem,
} from "./activity";

const ci = (over: Partial<CiRun>): CiRun => ({
  workflowName: "CI",
  status: "in_progress",
  conclusion: null,
  headSha: "abc",
  url: "u",
  steps: [],
  stepsDone: 0,
  stepsTotal: 0,
  ...over,
});

describe("ciRunState", () => {
  it("running while not completed", () => {
    expect(ciRunState(ci({ status: "in_progress" }))).toBe("running");
    expect(ciRunState(ci({ status: "queued" }))).toBe("running");
  });
  it("done on success", () => {
    expect(ciRunState(ci({ status: "completed", conclusion: "success" }))).toBe(
      "done",
    );
  });
  it("failed on failure/cancelled/timed_out", () => {
    expect(ciRunState(ci({ status: "completed", conclusion: "failure" }))).toBe(
      "failed",
    );
    expect(
      ciRunState(ci({ status: "completed", conclusion: "cancelled" })),
    ).toBe("failed");
    expect(
      ciRunState(ci({ status: "completed", conclusion: "timed_out" })),
    ).toBe("failed");
  });
  it("idle on skipped/neutral/null", () => {
    expect(ciRunState(ci({ status: "completed", conclusion: "skipped" }))).toBe(
      "idle",
    );
    expect(ciRunState(ci({ status: "completed", conclusion: null }))).toBe(
      "idle",
    );
  });
});

describe("ciRunToItem", () => {
  it("determinate progress from steps", () => {
    const item = ciRunToItem(
      ci({ headSha: "abc", stepsDone: 3, stepsTotal: 6 }),
      "main",
    );
    expect(item.progress).toEqual({
      kind: "determinate",
      value: 50,
      label: "3/6 steps",
    });
    expect(item.id).toBe("ci:abc");
    expect(item.subtitle).toBe("main");
    expect(item.kind).toBe("ci");
  });
  it("indeterminate when running with no steps", () => {
    const item = ciRunToItem(
      ci({ status: "queued", url: "", stepsTotal: 0 }),
      "main",
    );
    expect(item.progress).toEqual({ kind: "indeterminate" });
    expect(item.href).toBeUndefined();
  });
  it("null progress when finished with no steps", () => {
    const item = ciRunToItem(
      ci({ status: "completed", conclusion: "success", stepsTotal: 0 }),
      "main",
    );
    expect(item.progress).toBeNull();
    expect(item.state).toBe("done");
  });
});

describe("renderDeployState", () => {
  it("maps Render deploy statuses", () => {
    expect(renderDeployState("build_in_progress")).toBe("running");
    expect(renderDeployState("update_in_progress")).toBe("running");
    expect(renderDeployState("live")).toBe("done");
    expect(renderDeployState("update_failed")).toBe("failed");
    expect(renderDeployState("canceled")).toBe("failed");
    expect(renderDeployState("")).toBe("idle");
  });
});

describe("renderServiceToItem", () => {
  it("surfaces a building service as running+indeterminate", () => {
    const item = renderServiceToItem({
      id: "s1",
      name: "api",
      url: "u",
      deployStatus: "build_in_progress",
    });
    expect(item?.state).toBe("running");
    expect(item?.progress).toEqual({ kind: "indeterminate" });
  });
  it("surfaces a failed deploy with null progress", () => {
    const item = renderServiceToItem({
      id: "s1",
      name: "api",
      url: "u",
      deployStatus: "update_failed",
    });
    expect(item?.state).toBe("failed");
    expect(item?.progress).toBeNull();
  });
  it("hides a live (steady-state) service", () => {
    expect(
      renderServiceToItem({
        id: "s1",
        name: "api",
        url: "u",
        deployStatus: "live",
      }),
    ).toBeNull();
  });
});

describe("dockerContainerToItem", () => {
  it("surfaces a restarting/created container", () => {
    expect(
      dockerContainerToItem({
        id: "c1",
        name: "db",
        state: "restarting",
        status: "Restarting",
      })?.kind,
    ).toBe("docker");
    expect(
      dockerContainerToItem({
        id: "c2",
        name: "db",
        state: "created",
        status: "Created",
      })?.progress,
    ).toEqual({
      kind: "indeterminate",
    });
  });
  it("hides a running or exited container", () => {
    expect(
      dockerContainerToItem({
        id: "c1",
        name: "db",
        state: "running",
        status: "Up 3h",
      }),
    ).toBeNull();
    expect(
      dockerContainerToItem({
        id: "c2",
        name: "db",
        state: "exited",
        status: "Exited (0)",
      }),
    ).toBeNull();
  });
});
